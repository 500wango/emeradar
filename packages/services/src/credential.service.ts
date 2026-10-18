import { lookup } from 'node:dns/promises';
import { query } from '@emeradar/db';
import { EmeradarError, ErrorCode, readBodyWithLimit } from '@emeradar/core';
import { assertPublicHttpUrl } from './public-url';
import { normalizeCredentialHost } from './credential-host';

/**
 * 上线凭证（09 §8、10 §4.5、PRD v3.1 §1.8 第 5 条）。
 *
 * v3.1 的凭证**不再是 GO 的门禁**：GO 只扣配额、建项目壳、授权点火包；凭证是那之后
 * 用户自愿提交的一次核验。因此这里没有截止时间、没有逾期释放、没有重试次数上限，
 * 也没有"先质押再立项"的状态机。一次没通过只影响那次提交的结论：资源不释放，配额
 * 不退还，用户可以改完页面再交一次。
 *
 * 仍然不可动摇的一条：校验用的是**探针实际取回的内容**，不是用户填的字段。页面
 * 不可达、或通篇与机会主词无关，都不算"上线了"。
 */

export type CredentialType = 'DOMAIN_URL' | 'STORE_LISTING_URL' | 'PUBLIC_PAGE_URL';

export const CREDENTIAL_TYPES: readonly CredentialType[] = [
  'DOMAIN_URL',
  'STORE_LISTING_URL',
  'PUBLIC_PAGE_URL',
];

export function isCredentialType(value: string): value is CredentialType {
  return (CREDENTIAL_TYPES as readonly string[]).includes(value);
}

/** 探针取回的关键字段，原样落进 `project_credentials.probe` 供用户自查。 */
export interface CredentialProbe {
  ok: boolean;
  httpStatus: number | null;
  finalUrl: string | null;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  /** 命中词数 / 总词数，0–1。落库是为了让"为什么判它相关"可被复查。 */
  relevance: number;
  matchedTerms: string[];
  /** 拒绝理由（人可读，中文）；通过时为 null。 */
  reason: string | null;
}

/**
 * 占位页特征。判据必须落在**取回的内容**上：一个还没有内容的域名首页往往返回
 * 200，只靠状态码会把"占了个域名"当成"上线了"。
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /coming\s+soon/i,
  /under\s+construction/i,
  /site\s+is\s+temporarily\s+unavailable/i,
  /just\s+a\s+moment/i,
  /checking\s+your\s+browser/i,
  /index\s+of\s*\//i,
  /default\s+web\s+site\s+page/i,
  /welcome\s+to\s+nginx/i,
  /apache2?\s+ubuntu\s+default\s+page/i,
  /buy\s+this\s+domain/i,
  /domain\s+is\s+for\s+sale/i,
];

/**
 * 相关性判据：主词与簇内词中，**命中数 ≥ ⌈词数 / 2⌉ 且至少 1 个**。
 *
 * 取一半而不是"必须全中"，是因为簇内词是候选长尾，一个只做了主词的页面同样是
 * 真实上线；取一半而不是"命中任一"，是因为只做一个宽泛词（比如只出现 "pdf"）
 * 的页面可以是任何东西，那样这条规则就退化成不做校验。
 */
export function evaluateRelevance(terms: readonly string[], haystack: string): { matched: string[]; relevance: number } {
  const normalizedHaystack = normalizeForMatch(haystack);
  const unique = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  const matched = unique.filter((term) => normalizedHaystack.includes(normalizeForMatch(term)));
  return { matched, relevance: unique.length === 0 ? 0 : matched.length / unique.length };
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function extractFirst(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match?.[1] ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

/**
 * 取回页面并抽取判定所需的关键字段。
 *
 * `fetchImpl` 可注入，因为这条路径的全部风险都在网络边界上（不可达、超时、占位页、
 * 内网重定向），而这些都是必须被测试的分支——不能等到线上才发现。
 */
export async function probeCredential(input: {
  url: string;
  credentialType: CredentialType;
  terms: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 解析器注入口，理由见 `assertPublicHttpUrl`。生产路径不传。 */
  lookupImpl?: typeof lookup;
}): Promise<CredentialProbe> {
  const doFetch = input.fetchImpl ?? fetch;
  const timeout = input.timeoutMs ?? 6000;
  const resolve = { lookupImpl: input.lookupImpl };
  let current = await assertPublicHttpUrl(input.url, resolve);
  let response: Response | null = null;

  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await doFetch(current, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'EmeradarBot/1.0 (+https://emeradar.com/bot)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location || redirects === 3) {
      return rejection('Site redirects exceed the safety limit.', response.status, current.toString());
    }
    // 每一跳都重新过公网校验：一个公网域名可以把 Location 指向 169.254.169.254。
    current = await assertPublicHttpUrl(new URL(location, current).toString(), resolve);
  }

  const finalUrl = current.toString();
  if (!response || !response.ok) {
    return rejection(
      `The submitted page did not load (HTTP ${response?.status ?? 'no response'}).`,
      response?.status ?? null,
      finalUrl
    );
  }

  const html = await readBodyWithLimit(response);
  const title = extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = extractFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const metaDescription = extractFirst(
    html,
    /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i
  );

  const base = {
    httpStatus: response.status,
    finalUrl,
    title,
    h1,
    metaDescription,
  };

  const placeholderMatch = PLACEHOLDER_PATTERNS.find((pattern) => pattern.test(title || '') || pattern.test(html.slice(0, 4000)));
  if (placeholderMatch) {
    return { ...base, ok: false, relevance: 0, matchedTerms: [], reason: 'The page is a placeholder or parking page, not a launched product.' };
  }

  const haystack = [title, h1, metaDescription].filter(Boolean).join(' \n ');
  const { matched, relevance } = evaluateRelevance(input.terms, haystack);
  const threshold = Math.max(1, Math.ceil(new Set(input.terms.filter((t) => t.trim())).size / 2));
  if (matched.length < threshold) {
    return {
      ...base,
      ok: false,
      relevance,
      matchedTerms: matched,
      reason: `The page's title/description do not mention this opportunity's topic (matched ${matched.length} of the required ${threshold}).`,
    };
  }

  return { ...base, ok: true, relevance, matchedTerms: matched, reason: null };
}

function rejection(reason: string, httpStatus: number | null, finalUrl: string | null): CredentialProbe {
  return { ok: false, httpStatus, finalUrl, title: null, h1: null, metaDescription: null, relevance: 0, matchedTerms: [], reason };
}

export interface CredentialRow {
  id: string;
  credentialType: string;
  url: string;
  verificationState: string;
  rejectionReason: string | null;
  checkedAt: string | null;
}

export interface CredentialStatusView {
  projectId: string;
  /** `UNVERIFIED` / `PENDING` / `VERIFIED_OWNER` / `REJECTED`。 */
  credentialStatus: string;
  credentialVerifiedAt: string | null;
  credentials: CredentialRow[];
}

export class CredentialService {
  /** 该项目所属机会的主词与簇内词——相关性的判定依据。 */
  private static async opportunityTerms(projectId: string): Promise<string[]> {
    const res = await query<{ term: string }>(
      `SELECT COALESCE(q.query_text, c.primary_query) AS term
         FROM projects p
         JOIN opportunity_cards c ON c.opportunity_id = p.opportunity_id
         LEFT JOIN opportunity_queries oq ON oq.opportunity_id = p.opportunity_id
         LEFT JOIN queries q ON q.id = oq.query_id
        WHERE p.id = $1 AND COALESCE(q.query_text, c.primary_query) IS NOT NULL`,
      [projectId]
    );
    return res.rows.map((row) => row.term);
  }

  static async getCredentials(projectId: string, userId: string): Promise<CredentialStatusView> {
    const project = await query<{
      credential_status: string;
      credential_verified_at: Date | null;
      user_id: string;
    }>(
      `SELECT credential_status, credential_verified_at, user_id FROM projects WHERE id = $1`,
      [projectId]
    );
    const row = project.rows[0];
    if (!row || row.user_id !== userId) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    }
    const creds = await query<any>(
      `SELECT id, credential_type, url, verification_state, rejection_reason, checked_at
         FROM project_credentials WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );
    return {
      projectId,
      credentialStatus: row.credential_status,
      credentialVerifiedAt: row.credential_verified_at ? row.credential_verified_at.toISOString() : null,
      credentials: creds.rows.map((c) => ({
        id: c.id,
        credentialType: c.credential_type,
        url: c.url,
        verificationState: c.verification_state,
        rejectionReason: c.rejection_reason,
        checkedAt: c.checked_at ? new Date(c.checked_at).toISOString() : null,
      })),
    };
  }

  /**
   * 提交一份上线凭证并当场探针校验（09 §8、10 §4.5）。
   *
   * v3.1：没有截止时间，失败不释放任何资源、不退还配额，也没有重试次数上限。
   * `credential_status` 是状态真源——通过置 `VERIFIED_OWNER`，失败置 `REJECTED`，
   * 用户改完页面可以继续提交。
   */
  static async submitCredential(
    projectId: string,
    userId: string,
    input: { credentialType: string; url: string },
    options: { fetchImpl?: typeof fetch; lookupImpl?: typeof lookup } = {}
  ): Promise<{ verified: boolean; probe: CredentialProbe }> {
    if (!isCredentialType(input.credentialType)) {
      throw new EmeradarError(
        ErrorCode.VALIDATION_ERROR,
        `credential_type must be one of ${CREDENTIAL_TYPES.join(', ')}.`,
        400
      );
    }
    const project = await query<{ user_id: string; credential_status: string }>(
      `SELECT user_id, credential_status FROM projects WHERE id = $1`,
      [projectId]
    );
    const row = project.rows[0];
    if (!row || row.user_id !== userId) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    }
    // 已核验的凭证不允许被覆盖：`project_credentials_one_verified` 是每项目一条的部分
    // 唯一索引，覆盖等于把"哪次提交让它成立"从审计里抹掉。
    if (row.credential_status === 'VERIFIED_OWNER') {
      throw new EmeradarError(ErrorCode.CONFLICT, 'This project already has a verified credential.', 409);
    }

    const terms = await CredentialService.opportunityTerms(projectId);
    const probe = await probeCredential({
      url: input.url,
      credentialType: input.credentialType as CredentialType,
      terms,
      fetchImpl: options.fetchImpl,
      lookupImpl: options.lookupImpl,
    });

    const credentialId = `crd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await query(
      `INSERT INTO project_credentials
         (id, project_id, credential_type, url, host, verification_state, probe, checked_at, rejection_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), $8)`,
      [
        credentialId,
        projectId,
        input.credentialType,
        probe.finalUrl ?? input.url,
        normalizeCredentialHost(probe.finalUrl ?? input.url),
        probe.ok ? 'VERIFIED' : 'REJECTED',
        JSON.stringify({
          ok: probe.ok,
          httpStatus: probe.httpStatus,
          title: probe.title,
          h1: probe.h1,
          metaDescription: probe.metaDescription,
          relevance: probe.relevance,
          matchedTerms: probe.matchedTerms,
        }),
        probe.reason,
      ]
    );

    if (!probe.ok) {
      await query(
        `UPDATE projects SET credential_status = 'REJECTED', updated_at = NOW()
          WHERE id = $1 AND credential_status <> 'VERIFIED_OWNER'`,
        [projectId]
      );
      throw new EmeradarError(
        ErrorCode.CREDENTIAL_UNVERIFIED,
        probe.reason ?? 'The submitted credential could not be verified.',
        422,
        { details: { probe } }
      );
    }

    await query(
      `UPDATE projects
          SET credential_status = 'VERIFIED_OWNER',
              credential_verified_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [projectId]
    );
    return { verified: true, probe };
  }
}
