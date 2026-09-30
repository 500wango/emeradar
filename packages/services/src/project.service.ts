import { query } from '@emeradar/db';
import { EmeradarError, ErrorCode, BuildArchetype } from '@emeradar/core';
import { EntitlementService } from './entitlement.service';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';

export interface CreateProjectInput {
  opportunityId: string;
  decisionId?: string;
  reportId?: string;
  title: string;
  domain?: string;
  buildType?: BuildArchetype;
  targetKeywords?: string[];
}

export interface CreateExperimentProjectInput {
  experimentCardId: string;
  title: string;
  domain?: string;
  buildType?: BuildArchetype;
  targetKeywords?: string[];
}

export interface GscWeeklyDetailInput {
  weekStartDate: string;
  pageUrl?: string;
  query?: string;
  impressions: number;
  clicks: number;
  averagePosition?: number;
  source?: 'GSC' | 'SELF_REPORTED';
}

export interface GscSearchAnalyticsRow {
  date: string;
  page?: string;
  query?: string;
  impressions: number;
  clicks: number;
  position?: number;
}

export interface GscConnectionStatus {
  connected: boolean;
  propertyUrl?: string;
  lastSyncedAt?: string;
}

export interface SiteCheckResult {
  url: string;
  http: { ok: boolean; status?: number; finalUrl?: string };
  robots: 'ALLOW' | 'DISALLOW' | 'UNKNOWN';
  noindex: boolean | null;
  canonical: string | null;
  crawlableContent: boolean;
  sitemap: { status: 'FOUND' | 'UNKNOWN' | 'FAILED'; url: string };
}

function normalizeProjectDomain(value?: string): string | null {
  if (!value || !value.trim()) return null;
  const raw = value.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'Project domain must be a valid public hostname.', 400);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blocked = hostname === 'localhost' || hostname.endsWith('.local') || hostname === '::1'
    || hostname === '0.0.0.0' || hostname.startsWith('10.') || hostname.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) || hostname.startsWith('127.');
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' || parsed.username || parsed.password || blocked || parsed.port && !['80', '443'].includes(parsed.port)) {
    throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'Project domain must be a public HTTP(S) hostname without credentials or a custom port.', 400);
  }
  return hostname;
}

export class ProjectService {
  private static gscKey(): Buffer {
    const secret = process.env.GSC_TOKEN_ENCRYPTION_KEY;
    if (!secret) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'GSC token encryption is not configured.', 503);
    return createHash('sha256').update(secret).digest();
  }

  private static encryptGscToken(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.gscKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  private static decryptGscToken(value: string): Record<string, any> {
    const [iv, tag, ciphertext] = value.split('.');
    if (!iv || !tag || !ciphertext) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Stored GSC credentials are invalid.', 503);
    const decipher = createDecipheriv('aes-256-gcm', this.gscKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
  }

  private static async getGscAccessToken(projectId: string, userId: string): Promise<{ token: Record<string, any>; connection: { property_url: string | null } }> {
    await this.assertProjectOwned(projectId, userId);
    const result = await query<{ token_encrypted: string; property_url: string | null }>(
      `SELECT token_encrypted, property_url FROM gsc_connections WHERE project_id = $1`, [projectId],
    );
    const row = result.rows[0];
    if (!row) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Connect Google Search Console first.', 409);
    const token = this.decryptGscToken(row.token_encrypted);
    if (token.expiry_date && token.expiry_date < Date.now() + 60_000) {
      if (!token.refresh_token) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Google authorization expired; reconnect Search Console.', 409);
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Google Search Console OAuth is not configured.', 503);
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: token.refresh_token, grant_type: 'refresh_token' }),
      });
      const refreshed = await response.json();
      if (!response.ok || !refreshed.access_token) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Google authorization expired; reconnect Search Console.', 409);
      Object.assign(token, refreshed, { refresh_token: token.refresh_token, expiry_date: Date.now() + Number(refreshed.expires_in || 3600) * 1000 });
      await query(`UPDATE gsc_connections SET token_encrypted = $1 WHERE project_id = $2`, [this.encryptGscToken(token), projectId]);
    }
    return { token, connection: { property_url: row.property_url } };
  }

  static async getGscAuthorizationUrl(projectId: string, userId: string): Promise<{ url: string; state: string }> {
    await this.assertProjectOwned(projectId, userId);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GSC_REDIRECT_URI;
    if (!clientId || !redirectUri) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Google Search Console OAuth is not configured.', 503);
    const state = randomBytes(24).toString('base64url');
    await query(`DELETE FROM gsc_oauth_states WHERE project_id = $1 OR expires_at < NOW()`, [projectId]);
    await query(`INSERT INTO gsc_oauth_states (project_id, user_id, state_hash, expires_at) VALUES ($1,$2,$3,NOW() + INTERVAL '10 minutes')`, [projectId, userId, createHash('sha256').update(state).digest('hex')]);
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/webmasters.readonly', state });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state };
  }

  static async consumeGscOAuthState(projectId: string, userId: string, state: string): Promise<boolean> {
    const hash = createHash('sha256').update(state).digest('hex');
    const result = await query(`DELETE FROM gsc_oauth_states WHERE project_id = $1 AND user_id = $2 AND state_hash = $3 AND expires_at > NOW() RETURNING id`, [projectId, userId, hash]);
    return result.rows.length > 0;
  }

  private static isPrivateAddress(address: string): boolean {
    const value = address.toLowerCase();
    if (value === '::1' || value === '0.0.0.0' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
    if (value.includes(':')) return value.startsWith('::ffff:') ? this.isPrivateAddress(value.slice(7)) : false;
    const p = value.split('.').map(Number);
    return p.length === 4 && (p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] >= 224);
  }

  private static async publicUrl(raw: string): Promise<URL> {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'Target URL must be a public HTTP(S) URL.', 400);
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => this.isPrivateAddress(address))) throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'Target URL must resolve to a public address.', 400);
    return url;
  }

  static async inspectProjectSite(projectId: string, userId: string): Promise<SiteCheckResult> {
    const project = await this.assertProjectOwned(projectId, userId);
    if (!project.domain) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Set a project domain before running a site check.', 409);
    let current = await this.publicUrl(/^https?:\/\//i.test(project.domain) ? project.domain : `https://${project.domain}`);
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': 'EmeradarBot/1.0 (+https://emeradar.com/bot)', Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(6000) });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Site redirects exceed the safety limit.', 502);
      current = await this.publicUrl(new URL(location, current).toString());
    }
    const html = response && response.ok ? await response.text() : '';
    const lower = html.toLowerCase();
    const robotsResult = await (async () => {
      try {
        const robotsUrl = await this.publicUrl(new URL('/robots.txt', current).toString());
        const r = await fetch(robotsUrl, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
        if (!r.ok) return { status: 'UNKNOWN' as const, sitemaps: [] as string[] };
        const text = await r.text();
        const sitemaps = [...text.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)].map((match) => match[1]);
        return { status: /disallow:\s*\/\s*(?:$|\n)/i.test(text) ? 'DISALLOW' as const : 'ALLOW' as const, sitemaps };
      } catch {
        return { status: 'UNKNOWN' as const, sitemaps: [] as string[] };
      }
    })();
    const canonicalMatch = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]).map((tag) => {
      const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      return /(?:^|\s)canonical(?:\s|$)/i.test(rel) && href ? new URL(href, current).toString() : null;
    }).find(Boolean) || null;
    const metaRobots = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]).map((tag) => {
      const name = tag.match(/\b(?:name|http-equiv)\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] || '';
      return /^(?:robots|googlebot)$/i.test(name) ? content : '';
    }).filter(Boolean).join(',');
    const noindex = html ? /(?:^|[\s,])noindex(?:[\s,]|$)/i.test(metaRobots) : null;
    const sitemapCandidates = [
      ...robotsResult.sitemaps,
      ...[...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]).map((tag) => {
        const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || '';
        const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
        return /(?:^|\s)sitemap(?:\s|$)/i.test(rel) && href ? new URL(href, current).toString() : null;
      }).filter((value): value is string => Boolean(value)),
      new URL('/sitemap.xml', current).toString(),
    ];
    let sitemap: SiteCheckResult['sitemap'] = { status: 'UNKNOWN', url: sitemapCandidates[0] };
    for (const candidate of [...new Set(sitemapCandidates)]) {
      try {
        const sitemapUrl = await this.publicUrl(candidate);
        const sitemapResponse = await fetch(sitemapUrl, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
        if (sitemapResponse.ok) { sitemap = { status: 'FOUND', url: sitemapUrl.toString() }; break; }
        if (sitemapResponse.status === 404) sitemap = { status: 'FAILED', url: sitemapUrl.toString() };
        else if (sitemapResponse.status >= 400) sitemap = { status: 'UNKNOWN', url: sitemapUrl.toString() };
      } catch {
        sitemap = { status: 'UNKNOWN', url: candidate };
      }
    }
    return { url: current.toString(), http: { ok: Boolean(response?.ok), status: response?.status, finalUrl: current.toString() }, robots: robotsResult.status, noindex, canonical: canonicalMatch, crawlableContent: /<body[\s>]/i.test(html) && lower.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length >= 80, sitemap };
  }

  static async completeGscAuthorization(projectId: string, userId: string, code: string, redirectUri: string): Promise<void> {
    await this.assertProjectOwned(projectId, userId);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Google Search Console OAuth is not configured.', 503);
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
    const token = await response.json();
    if (!response.ok || !token.access_token) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Google OAuth token exchange failed.', 502);
    token.expiry_date = Date.now() + Number(token.expires_in || 3600) * 1000;
    if (!token.refresh_token) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Google did not return offline access. Disconnect the existing grant and reconnect.', 502);
    await query(`DELETE FROM gsc_connections WHERE project_id = $1`, [projectId]);
    await query(`INSERT INTO gsc_connections (id, project_id, property_url, token_encrypted) VALUES ($1,$2,NULL,$3)`, [`gsc_${projectId}`, projectId, this.encryptGscToken(token)]);
  }

  static async listGscProperties(projectId: string, userId: string): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
    const { token } = await this.getGscAccessToken(projectId, userId);
    const response = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: { authorization: `Bearer ${token.access_token}` } });
    const payload = await response.json();
    if (!response.ok) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Unable to read Google Search Console properties.', 502);
    return (payload.siteEntry || []).map((item: any) => ({ siteUrl: item.siteUrl, permissionLevel: item.permissionLevel }));
  }

  static async selectGscProperty(projectId: string, userId: string, propertyUrl: string): Promise<void> {
    const validated = await this.validateProjectProperty(projectId, userId, propertyUrl);
    const properties = await this.listGscProperties(projectId, userId);
    if (!properties.some((item) => item.siteUrl.replace(/\/$/, '') === validated.propertyUrl.replace(/\/$/, ''))) {
      throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'This Google account does not have access to the selected property.', 403);
    }
    await query(`UPDATE gsc_connections SET property_url = $1 WHERE project_id = $2`, [validated.propertyUrl, projectId]);
  }

  static async getGscProperties(projectId: string, userId: string): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
    const { connection } = await this.getGscAccessToken(projectId, userId);
    if (connection.property_url) return [{ siteUrl: connection.property_url, permissionLevel: 'selected' }];
    return this.listGscProperties(projectId, userId);
  }

  static async assertProjectOwned(projectId: string, userId: string): Promise<any> {
    const result = await query<any>(
      `SELECT id, project_kind, domain, status FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, userId],
    );
    if (!result.rows[0]) throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    return result.rows[0];
  }

  static async validateProjectProperty(projectId: string, userId: string, propertyUrl: string): Promise<{ propertyUrl: string; status: 'UNVERIFIED' }> {
    await this.assertProjectOwned(projectId, userId);
    let parsed: URL;
    try { parsed = new URL(propertyUrl); } catch { throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'GSC property URL must be a valid URL.', 400); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'GSC property URL must be a public HTTP(S) URL without credentials or query parameters.', 400);
    }
    return { propertyUrl: parsed.toString().replace(/\/$/, ''), status: 'UNVERIFIED' };
  }

  static async getGscConnectionStatus(projectId: string, userId: string): Promise<GscConnectionStatus> {
    const owned = await query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
    if (!owned.rows.length) throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    const result = await query<{ property_url: string; last_synced_at: string | null }>(
      `SELECT property_url, last_synced_at FROM gsc_connections WHERE project_id = $1 AND property_url IS NOT NULL LIMIT 1`,
      [projectId],
    );
    const row = result.rows[0];
    return row ? { connected: true, propertyUrl: row.property_url!, lastSyncedAt: row.last_synced_at ?? undefined } : { connected: false };
  }

  static async disconnectGsc(projectId: string, userId: string): Promise<void> {
    const owned = await query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
    if (!owned.rows.length) throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    await query(`DELETE FROM gsc_connections WHERE project_id = $1`, [projectId]);
  }

  static async createExperimentProject(userId: string, input: CreateExperimentProjectInput): Promise<any> {
    const cardRes = await query<{ id: string }>(
      `SELECT id FROM experiment_cards WHERE id = $1 AND status IN ('PROPOSED','ACTIVE')`,
      [input.experimentCardId],
    );
    if (cardRes.rows.length === 0) {
      throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Experiment card is unavailable or already started.', 409);
    }
    const ent = await EntitlementService.getUserEntitlements(userId);
    if (ent.currentProjectsCount >= ent.maxProjects) {
      throw new EmeradarError(ErrorCode.QUOTA_EXCEEDED, `You have reached the maximum allowed projects (${ent.maxProjects}).`, 403);
    }
    const projectId = `prj_${Date.now()}`;
    const domain = normalizeProjectDomain(input.domain);
    const res = await query<any>(
      `INSERT INTO projects (id, user_id, project_kind, experiment_card_id, title, domain, build_type, status, target_keywords)
       VALUES ($1, $2, 'EXPERIMENT', $3, $4, $5, $6, 'IN_DEVELOPMENT', $7)
       ON CONFLICT (user_id, experiment_card_id) WHERE experiment_card_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [projectId, userId, input.experimentCardId, input.title, domain, input.buildType || 'LIGHTWEIGHT_TOOL', input.targetKeywords || []],
    );
    if (!res.rows[0]) {
      throw new EmeradarError(ErrorCode.CONFLICT, 'You already have a project for this experiment card.', 409);
    }
    return res.rows[0];
  }

  static async syncGscSearchAnalytics(
    projectId: string,
    userId: string,
    rows: GscSearchAnalyticsRow[]
  ): Promise<{ count: number; weekStartDates: string[] }> {
    const grouped = new Map<string, Map<string, GscWeeklyDetailInput>>();
    for (const row of rows) {
      const date = new Date(`${row.date}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) continue;
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() - day + 1);
      const week = date.toISOString().slice(0, 10);
      const byKey = grouped.get(week) || new Map<string, GscWeeklyDetailInput>();
      const pageUrl = row.page || '';
      const queryText = row.query || '';
      const key = `${pageUrl}\u0000${queryText}`;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, { weekStartDate: week, pageUrl, query: queryText, impressions: row.impressions, clicks: row.clicks, averagePosition: row.position, source: 'GSC' });
      } else {
        const totalImpressions = current.impressions + row.impressions;
        current.averagePosition = totalImpressions > 0
          ? ((current.averagePosition || 0) * current.impressions + (row.position || 0) * row.impressions) / totalImpressions
          : 0;
        current.impressions = totalImpressions;
        current.clicks += row.clicks;
      }
      grouped.set(week, byKey);
    }
    let count = 0;
    for (const [week, byKey] of grouped.entries()) {
      const list = [...byKey.values()];
      const weekEnd = new Date(`${week}T00:00:00Z`);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      const weekEndDate = weekEnd.toISOString().slice(0, 10);
      for (const row of rows.filter((item) => item.date >= week && item.date < weekEndDate)) {
        await query(
          `INSERT INTO gsc_metrics_daily (project_id, observation_date, page_url, query, impressions, clicks, average_position, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'GSC')
           ON CONFLICT (project_id, observation_date, page_url, query) DO UPDATE SET impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, average_position=EXCLUDED.average_position, source=EXCLUDED.source`,
          [projectId, row.date, row.page || '', row.query || '', row.impressions, row.clicks, row.position || 0],
        );
      }
      count += (await this.upsertGscWeeklyDetails(projectId, userId, list)).count;
      const impressions = list.reduce((sum, row) => sum + row.impressions, 0);
      const clicks = list.reduce((sum, row) => sum + row.clicks, 0);
      const averagePosition = impressions > 0
        ? list.reduce((sum, row) => sum + (row.averagePosition || 0) * row.impressions, 0) / impressions
        : 0;
      await query(
        `INSERT INTO gsc_metrics_weekly (project_id, week_start_date, impressions, clicks, average_position)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (project_id, week_start_date) DO UPDATE SET
           impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, average_position = EXCLUDED.average_position`,
        [projectId, week, impressions, clicks, averagePosition]
      );
    }
    return { count, weekStartDates: [...grouped.keys()] };
  }

  static async syncGscProject(projectId: string, userId: string, startDate: string, endDate: string): Promise<{ count: number; weekStartDates: string[] }> {
    const { token, connection } = await this.getGscAccessToken(projectId, userId);
    if (!connection.property_url) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Select a Google Search Console property first.', 409);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
      throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'Invalid Search Console date range.', 400);
    }
    const response = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(connection.property_url)}/searchAnalytics/query`, {
      method: 'POST', headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, dimensions: ['date', 'page', 'query'], rowLimit: 25000 }),
    });
    const payload = await response.json();
    if (!response.ok) throw new EmeradarError(ErrorCode.PRECONDITION_FAILED, 'Unable to read Search Console analytics.', 502);
    const rows: GscSearchAnalyticsRow[] = (payload.rows || []).flatMap((row: any) => {
      const keys = Array.isArray(row.keys) ? row.keys : [];
      return keys[0] ? [{ date: keys[0], page: keys[1], query: keys[2], impressions: Number(row.impressions || 0), clicks: Number(row.clicks || 0), position: Number(row.position || 0) }] : [];
    });
    const result = await this.syncGscSearchAnalytics(projectId, userId, rows);
    await query(`UPDATE gsc_connections SET last_synced_at = NOW() WHERE project_id = $1`, [projectId]);
    return result;
  }
  static async upsertGscWeeklyDetails(
    projectId: string,
    userId: string,
    rows: GscWeeklyDetailInput[]
  ): Promise<{ count: number }> {
    const owned = await query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
    if (owned.rows.length === 0) throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    for (const row of rows) {
      await query(
        `INSERT INTO gsc_metrics_weekly_detail
          (project_id, week_start_date, page_url, query, impressions, clicks, average_position, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (project_id, week_start_date, page_url, query) DO UPDATE SET
           impressions = EXCLUDED.impressions,
           clicks = EXCLUDED.clicks,
           average_position = EXCLUDED.average_position,
           source = EXCLUDED.source`,
        [projectId, row.weekStartDate, row.pageUrl || '', row.query || '', row.impressions, row.clicks, row.averagePosition || 0, row.source || 'GSC']
      );
    }
    return { count: rows.length };
  }

  /**
   * Create a new tracking project linked to an opportunity decision
   */
  static async createProject(
    userId: string,
    input: CreateProjectInput
  ): Promise<any> {
    const cardRes = await query<{ verdict: string; confidence: string; status: string }>(
      `SELECT c.verdict, c.confidence, o.status
       FROM opportunity_cards c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE c.opportunity_id = $1`,
      [input.opportunityId]
    );
    const card = cardRes.rows[0];
    const publishable =
      card &&
      card.status === 'TRACKED' &&
      (card.verdict === 'BUILD_NOW' || card.verdict === 'EARLY_BET') &&
      card.confidence !== 'LOW';
    if (!publishable) {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'A project can only be created from a published BUILD NOW or EARLY BET. This opportunity is still under observation.',
        409
      );
    }

    const ent = await EntitlementService.getUserEntitlements(userId);
    if (ent.currentProjectsCount >= ent.maxProjects) {
      throw new EmeradarError(
        ErrorCode.QUOTA_EXCEEDED,
        `You have reached the maximum allowed projects (${ent.maxProjects}) for your plan. Please upgrade to create more projects.`,
        403,
        { currentProjects: ent.currentProjectsCount, maxProjects: ent.maxProjects }
      );
    }

    // Ensure decision exists or create GO decision
    let decisionId = input.decisionId;
    if (!decisionId) {
      const verdictRes = await query<{ id: string }>(
        `SELECT id FROM verdicts WHERE opportunity_id = $1 ORDER BY obs_date DESC LIMIT 1`,
        [input.opportunityId]
      );
      const verdictId = verdictRes.rows[0]?.id;
      if (!verdictId) {
        throw new EmeradarError(
          ErrorCode.PRECONDITION_FAILED,
          'A project requires a persisted verdict. This opportunity is publishable only after the verdict ledger is written.',
          409
        );
      }

      const dcsId = `dcs_${Date.now()}`;
      await query(
        `INSERT INTO decisions (id, opportunity_id, user_id, decision, verdict_id, reasons, channel)
         VALUES ($1, $2, $3, 'GO', $4, '{"Direct project initiation"}', 'WEB')`,
        [dcsId, input.opportunityId, userId, verdictId]
      );
      decisionId = dcsId;
    } else {
      const decisionRes = await query<{ id: string }>(
        `SELECT id FROM decisions WHERE id = $1 AND user_id = $2 AND opportunity_id = $3 AND decision = 'GO'`,
        [decisionId, userId, input.opportunityId]
      );
      if (decisionRes.rows.length === 0) {
        throw new EmeradarError(ErrorCode.FORBIDDEN, 'Decision does not belong to this user and opportunity.', 403);
      }
    }

    if (input.reportId) {
      const reportRes = await query<{ id: string }>(
        `SELECT id
         FROM opportunity_reports
         WHERE id = $1 AND user_id = $2 AND opportunity_id = $3`,
        [input.reportId, userId, input.opportunityId]
      );
      if (reportRes.rows.length === 0) {
        throw new EmeradarError(ErrorCode.FORBIDDEN, 'Report does not belong to this user and opportunity.', 403);
      }
    }

    const projectId = `prj_${Date.now()}`;
    const domain = normalizeProjectDomain(input.domain);
    const res = await query<any>(
      `INSERT INTO projects (
        id, user_id, opportunity_id, decision_id, report_id,
        title, domain, build_type, status, launch_date, target_keywords
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, 'IN_DEVELOPMENT', NULL, $9
      ) RETURNING *;`,
      [
        projectId,
        userId,
        input.opportunityId,
        decisionId,
        input.reportId || null,
        input.title,
        domain,
        input.buildType || 'LIGHTWEIGHT_TOOL',
        input.targetKeywords || [],
      ]
    );

    return res.rows[0];
  }

  /**
   * List all projects for a user with aggregated GSC metrics
   */
  static async listUserProjects(userId: string): Promise<any[]> {
    const res = await query<any>(
      `SELECT 
        p.*,
        o.title as opportunity_title,
        o.slug as opportunity_slug,
        c.verdict as current_verdict,
        COALESCE(SUM(g.impressions), 0)::integer as total_impressions,
        COALESCE(SUM(g.clicks), 0)::integer as total_clicks
       FROM projects p
       LEFT JOIN opportunities o ON o.id = p.opportunity_id
       LEFT JOIN opportunity_cards c ON c.opportunity_id = o.id
       LEFT JOIN gsc_metrics_weekly g ON g.project_id = p.id
       WHERE p.user_id = $1
       GROUP BY p.id, o.title, o.slug, c.verdict
       ORDER BY p.created_at DESC`,
      [userId]
    );

    return res.rows;
  }

  /**
   * Get detailed project stats and GSC weekly trajectory
   */
  static async getProjectDetail(projectId: string, userId: string): Promise<any> {
    const projRes = await query<any>(
      `SELECT p.*, o.title as opportunity_title, o.slug as opportunity_slug,
              c.verdict as current_verdict, c.primary_query
       FROM projects p
       LEFT JOIN opportunities o ON o.id = p.opportunity_id
       LEFT JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE p.id = $1 AND p.user_id = $2`,
      [projectId, userId]
    );

    if (projRes.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Project not found: ${projectId}`,
        404
      );
    }

    const project = projRes.rows[0];

    // Weekly metrics
    const metricsRes = await query<any>(
      `SELECT week_start_date, impressions, clicks, average_position
       FROM gsc_metrics_weekly
       WHERE project_id = $1
       ORDER BY week_start_date ASC`,
      [projectId]
    );

    const dailyRes = await query<any>(
      `SELECT observation_date, page_url, query, impressions, clicks, average_position, source
       FROM gsc_metrics_daily WHERE project_id = $1 ORDER BY observation_date ASC, page_url, query`,
      [projectId]
    );
    const detailRes = dailyRes.rows.length ? dailyRes : await query<any>(
      `SELECT week_start_date AS observation_date, page_url, query, impressions, clicks, average_position, source
       FROM gsc_metrics_weekly_detail WHERE project_id = $1 ORDER BY week_start_date ASC, page_url, query`,
      [projectId]
    );
    const launchDate = project.launch_date ? new Date(project.launch_date) : null;
    const outcomes = [7, 14, 30].map((day) => {
      if (!launchDate) return { day, status: 'PENDING', impressions: null, clicks: null, queries: null, pages: null, averagePosition: null };
      const cutoff = new Date(launchDate);
      cutoff.setDate(cutoff.getDate() + day);
      if (new Date() < cutoff) return { day, status: 'PENDING', impressions: null, clicks: null, queries: null, pages: null, averagePosition: null };
      const rows = detailRes.rows.filter((r) => {
        const week = new Date(r.observation_date);
        return week >= launchDate && week <= cutoff;
      });
      if (rows.length === 0) return { day, status: 'PENDING', impressions: null, clicks: null, queries: null, pages: null, averagePosition: null };
      const impressions = rows.reduce((sum, r) => sum + Number(r.impressions || 0), 0);
      const clicks = rows.reduce((sum, r) => sum + Number(r.clicks || 0), 0);
      const weightedPosition = rows.reduce((sum, r) => sum + Number(r.average_position || 0) * Number(r.impressions || 0), 0);
      return { day, status: 'OBSERVED', impressions, clicks, queries: new Set(rows.map((r) => r.query).filter(Boolean)).size, pages: new Set(rows.map((r) => r.page_url).filter(Boolean)).size, averagePosition: impressions ? weightedPosition / impressions : null };
    });

    return {
      project,
      metrics: metricsRes.rows,
      metricDetails: detailRes.rows,
      outcomes,
    };
  }

  /**
   * Update status of project
   */
  static async updateProjectStatus(
    projectId: string,
    userId: string,
    status: 'IN_DEVELOPMENT' | 'LAUNCHED' | 'ARCHIVED',
    domain?: string
  ): Promise<any> {
    const normalizedDomain = normalizeProjectDomain(domain);
    const res = await query<any>(
      `UPDATE projects
       SET status = $1,
           domain = COALESCE($2, domain),
           launch_date = CASE WHEN $1 = 'LAUNCHED' AND launch_date IS NULL THEN CURRENT_DATE ELSE launch_date END,
           updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [status, normalizedDomain, projectId, userId]
    );

    if (res.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Project not found: ${projectId}`,
        404
      );
    }

    return res.rows[0];
  }
}
