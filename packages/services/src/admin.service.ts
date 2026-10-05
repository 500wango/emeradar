import { query, transaction } from '@emeradar/db';
import { AppError } from '@emeradar/core';
import { randomBytes } from 'node:crypto';
import { AuthService } from './auth.service';
import {
  discoverSources,
  generateDiscoveryIntents,
  validateDiscoveryIntents,
  runDailyPipeline,
  incubateCandidatesFromDiscovery,
} from './pipeline';

// Maximum time an admin HTTP trigger will wait synchronously for a heavy
// pipeline task. The task keeps running in-process under its advisory lock
// even after we return to the caller, and any re-trigger is rejected by that
// lock until the run finishes — so this only bounds request latency.
const PIPELINE_MAX_WAIT_MS = 120_000;

function withPipelineTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} exceeded the ${Math.round(PIPELINE_MAX_WAIT_MS / 1000)}s synchronous wait limit ` +
            `and is still running in the background under a concurrency lock. ` +
            `Do not re-trigger until it completes.`
        )
      );
    }, PIPELINE_MAX_WAIT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface AdminUserListItem {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT';
  tier: 'FREE' | 'PRO' | 'TEAM';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  createdAt: string;
  updatedAt: string;
  projectsCount: number;
  alertsCount: number;
  apiKeysCount: number;
  subscriptionPlanCode: string | null;
  hasActiveSubscription: boolean;
}

export interface AdminUserStats {
  totalUsers: number;
  activeUsers: number;
  paidUsers: number;
  staffUsers: number;
}

export interface AdminPipelineOverview {
  opportunityStats: {
    tracked: number;
    candidate: number;
    archived: number;
    total: number;
  };
  costTodayUsd: number;
  dailyBudgetLimitUsd: number;
  latestCheckpoint: {
    obsDate: string;
    merkleRoot: string;
    totalRecords: number;
    verifiedAt: string;
  } | null;
  recentCollectorRuns: Array<{
    id: string;
    sourceId: string;
    sourceName: string;
    status: string;
    itemsCollected: number;
    startedAt: string;
    finishedAt: string | null;
    errorMessage: string | null;
  }>;
  latestDiscoverySignals: Array<{
    id: string;
    title: string;
    provider: string;
    sourceUrl: string;
    collectedAt: string;
  }>;
}

export interface AdminCandidateItem {
  id: string;
  slug: string;
  title: string;
  primaryQuery: string;
  status: string;
  marketCountry: string;
  researchLanguage: string;
  firstObservedDate: string;
  observationDays: number;
  discoverySource: string | null;
  candidateReason: string | null;
  recommendedArchetype: string;
  executionClass: string;
}

export interface AdminSourceItem {
  id: string;
  type: string;
  name: string;
  config: Record<string, any>;
  isActive: boolean;
  tosRiskLevel: string;
  createdAt: string;
}

export class AdminService {
  /**
   * Retrieves overall pipeline health, API cost watermark, and recent collector execution runs
   */
  static async getPipelineOverview(): Promise<AdminPipelineOverview> {
    // 1. Opportunity counts by status
    const statsRes = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM opportunities GROUP BY status`
    );
    let tracked = 0;
    let candidate = 0;
    let archived = 0;
    for (const r of statsRes.rows) {
      const c = parseInt(r.count, 10) || 0;
      if (r.status === 'TRACKED') tracked = c;
      else if (r.status === 'CANDIDATE') candidate = c;
      else if (r.status === 'ARCHIVED') archived = c;
    }

    // 2. Today's API costs from cost_ledger
    const costRes = await query<{ total_cost: string }>(
      `SELECT COALESCE(SUM(cost_usd), 0)::text AS total_cost
       FROM cost_ledger
       WHERE recorded_at >= CURRENT_DATE`
    );
    const costTodayUsd = parseFloat(costRes.rows[0]?.total_cost || '0');

    // 3. Latest ledger checkpoint
    const ckpRes = await query<{
      obs_date: string;
      merkle_root: string;
      total_records: number;
      verified_at: string;
    }>(
      `SELECT obs_date::text, merkle_root, total_records, verified_at::text
       FROM ledger_checkpoints
       ORDER BY obs_date DESC
       LIMIT 1`
    );
    const latestCkp = ckpRes.rows[0]
      ? {
          obsDate: ckpRes.rows[0].obs_date,
          merkleRoot: ckpRes.rows[0].merkle_root,
          totalRecords: ckpRes.rows[0].total_records,
          verifiedAt: ckpRes.rows[0].verified_at,
        }
      : null;

    // 4. Recent collector runs
    const runsRes = await query<{
      id: string;
      source_id: string;
      source_name: string;
      status: string;
      items_collected: number;
      started_at: string;
      finished_at: string | null;
      error_message: string | null;
    }>(
      `SELECT cr.id, cr.source_id, COALESCE(s.name, cr.source_id) AS source_name,
              cr.status, cr.items_collected, cr.started_at::text, cr.finished_at::text, cr.error_message
       FROM collector_runs cr
       LEFT JOIN sources s ON s.id = cr.source_id
       ORDER BY cr.started_at DESC
       LIMIT 12`
    );

    // 5. Latest discovery signals
    const signalsRes = await query<{
      id: string;
      title: string;
      provider: string;
      source_url: string;
      collected_at: string;
    }>(
      `SELECT id, title, provider, source_url, first_collected_at::text as collected_at
       FROM discovery_items
       ORDER BY first_collected_at DESC
       LIMIT 15`
    );

    return {
      opportunityStats: {
        tracked,
        candidate,
        archived,
        total: tracked + candidate + archived,
      },
      costTodayUsd,
      dailyBudgetLimitUsd: 20.0,
      latestCheckpoint: latestCkp,
      recentCollectorRuns: runsRes.rows.map((r) => ({
        id: r.id,
        sourceId: r.source_id,
        sourceName: r.source_name,
        status: r.status,
        itemsCollected: r.items_collected,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        errorMessage: r.error_message,
      })),
      latestDiscoverySignals: signalsRes.rows.map((r) => ({
        id: r.id,
        title: r.title,
        provider: r.provider,
        sourceUrl: r.source_url,
        collectedAt: r.collected_at,
      })),
    };
  }

  /**
   * Lists candidate opportunities with filtering and observation depth
   */
  static async listCandidates(options?: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AdminCandidateItem[]; total: number }> {
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = Math.max(0, options?.offset || 0);
    const search = options?.search?.trim();

    let whereClause = `WHERE o.status = 'CANDIDATE'`;
    const params: any[] = [];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      whereClause += ` AND (LOWER(o.title) LIKE $${params.length} OR LOWER(COALESCE(q.query_text, '')) LIKE $${params.length})`;
    }

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM opportunities o
       LEFT JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
       LEFT JOIN queries q ON q.id = oq.query_id
       ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listParams = [...params, limit, offset];
    const itemsRes = await query<{
      id: string;
      slug: string;
      title: string;
      primary_query: string | null;
      status: string;
      market_country: string;
      research_language: string;
      first_observed_date: string | null;
      observation_days: string;
      discovery_source: string | null;
      candidate_reason: string | null;
      recommended_archetype: string;
      execution_class: string;
    }>(
      `SELECT o.id, o.slug, o.title, q.query_text AS primary_query, o.status,
              o.market_country, o.research_language, o.first_observed_date::text,
              COALESCE(obs.days_count, 0)::text AS observation_days,
              o.discovery_source, o.candidate_reason,
              o.recommended_archetype, o.execution_class
       FROM opportunities o
       LEFT JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
       LEFT JOIN queries q ON q.id = oq.query_id
       LEFT JOIN (
         SELECT query_id, COUNT(DISTINCT observed_date) AS days_count
         FROM autocomplete_observations
         GROUP BY query_id
       ) obs ON obs.query_id = q.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    return {
      total,
      items: itemsRes.rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        primaryQuery: r.primary_query || r.title,
        status: r.status,
        marketCountry: r.market_country,
        researchLanguage: r.research_language,
        firstObservedDate: r.first_observed_date || 'N/A',
        observationDays: parseInt(r.observation_days, 10) || 0,
        discoverySource: r.discovery_source,
        candidateReason: r.candidate_reason,
        recommendedArchetype: r.recommended_archetype,
        executionClass: r.execution_class,
      })),
    };
  }

  /**
   * Moderates a candidate opportunity (e.g. discard as ARCHIVED or promote to TRACKED)
   */
  static async moderateCandidate(
    opportunityId: string,
    action: 'ARCHIVE' | 'PROMOTE_TO_TRACKED'
  ): Promise<{ success: boolean; newStatus: string }> {
    if (action === 'ARCHIVE') {
      const res = await query(
        `UPDATE opportunities SET status = 'ARCHIVED' WHERE id = $1`,
        [opportunityId]
      );
      if ((res.rowCount ?? 0) === 0) {
        throw AppError.notFound('Opportunity not found.');
      }
      return { success: true, newStatus: 'ARCHIVED' };
    }

    if (action === 'PROMOTE_TO_TRACKED') {
      await transaction(async (client) => {
        // 1. Update opportunity status
        const updateRes = await client.query(
          `UPDATE opportunities SET status = 'TRACKED' WHERE id = $1 RETURNING *`,
          [opportunityId]
        );
        if (updateRes.rows.length === 0) {
          throw AppError.notFound('Opportunity not found.');
        }
        const opp = updateRes.rows[0];

        // 2. Fetch primary query
        const qRes = await client.query<{ query_text: string }>(
          `SELECT q.query_text FROM opportunity_queries oq
           JOIN queries q ON q.id = oq.query_id
           WHERE oq.opportunity_id = $1 AND oq.role = 'PRIMARY'`,
          [opportunityId]
        );
        const primaryQuery = qRes.rows[0]?.query_text || opp.title;

        // 3. Ensure card exists
        await client.query(
          `INSERT INTO opportunity_cards (
             opportunity_id, slug, primary_query,
             verdict, lifecycle, recommended_archetype, execution_class,
             d_basis_points, m_basis_points, w_basis_points,
             d_band, m_band, w_band, confidence,
             why_now_summary, top_idea, first_observed_at
           ) VALUES (
             $1, $2, $3,
             'BUILD_NOW', 'EARLY_WINDOW', $4, $5,
             8000, 7500, 7800,
             'HIGH', 'MEDIUM', 'HIGH', 'HIGH',
             $6, $7, NOW()
           )
           ON CONFLICT (opportunity_id) DO UPDATE SET
             verdict = 'BUILD_NOW',
             updated_at = NOW()`,
          [
            opp.id,
            opp.slug,
            primaryQuery,
            opp.recommended_archetype || 'LIGHTWEIGHT_TOOL',
            opp.execution_class || 'S',
            opp.candidate_reason || 'Manually verified and promoted by administrator.',
            `Specialized solution for ${primaryQuery}`,
          ]
        );
      });

      return { success: true, newStatus: 'TRACKED' };
    }

    throw AppError.badRequest('Invalid action.');
  }

  /**
   * Lists all configured signal sources
   */
  static async listSources(): Promise<AdminSourceItem[]> {
    const res = await query<{
      id: string;
      type: string;
      name: string;
      config: Record<string, any>;
      is_active: boolean;
      tos_risk_level: string;
      created_at: string;
    }>(
      `SELECT id, type, name, config, is_active, tos_risk_level, created_at::text
       FROM sources
       ORDER BY created_at ASC`
    );

    return res.rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      config: r.config || {},
      isActive: r.is_active,
      tosRiskLevel: r.tos_risk_level,
      createdAt: r.created_at,
    }));
  }

  /**
   * Adds an RSS signal source
   */
  static async addRssSource(name: string, url: string): Promise<AdminSourceItem> {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) {
      throw AppError.badRequest('Name and Feed URL are required.');
    }

    const sourceId = `src_rss_${Date.now()}`;
    await query(
      `INSERT INTO sources (id, type, name, config, tos_risk_level, is_active)
       VALUES ($1, 'DISCOVERY', $2, $3, 'LOW', true)`,
      [sourceId, trimmedName, JSON.stringify({ url: trimmedUrl, provider: 'RSS' })]
    );

    const created = await query<any>(`SELECT * FROM sources WHERE id = $1`, [sourceId]);
    const r = created.rows[0];
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      config: r.config || {},
      isActive: r.is_active,
      tosRiskLevel: r.tos_risk_level,
      createdAt: r.created_at,
    };
  }

  /**
   * Toggles active state of a source
   */
  static async toggleSource(sourceId: string, isActive: boolean): Promise<void> {
    await query(`UPDATE sources SET is_active = $1 WHERE id = $2`, [isActive, sourceId]);
  }

  /**
   * Triggers an automated worker task asynchronously
   * Triggers an automated worker task directly in-process
   */
  static async triggerTask(task: 'discover' | 'generate-intents' | 'validate-intents' | 'run-daily'): Promise<{
    task: string;
    output: string;
    exitCode: number;
  }> {
    const logs: string[] = [];
    const log = (msg: string) => {
      console.log(msg);
      logs.push(msg);
    };

    try {
      if (task === 'discover') {
        log('[pipeline] Starting signal discovery across active sources and feeds...');
        const res = await withPipelineTimeout(discoverSources(), 'Signal discovery');
        log('[pipeline] Discovery completed:');
        log(` - Sources scanned: ${res.sources}`);
        log(` - Raw items collected: ${res.collected}`);
        log(` - New items recorded: ${res.inserted}`);
        log(` - Failed sources: ${res.failed}`);

        if (res.recentItems.length > 0) {
          log('\n[pipeline] Recently captured raw signals:');
          for (const item of res.recentItems.slice(0, 10)) {
            log(` • [${item.provider}] ${item.title}`);
          }
        }

        // Automatic incubation into Candidate Opportunities
        log('\n[pipeline] Incubating fresh candidates from raw signals into Candidate Pool...');
        const candidates = await incubateCandidatesFromDiscovery(15);
        if (candidates.length > 0) {
          log(`[pipeline] Successfully incubated ${candidates.length} new candidate opportunities:`);
          for (const c of candidates) {
            log(` • [${c.archetype}] ${c.title} (Query: "${c.primaryQuery}")`);
          }
          log('\nAll new candidates are ready for review in "候选池治理 (/admin/candidates)"!');
        } else {
          log('[pipeline] All captured signals are already evaluated or present in candidate pool.');
        }

        return {
          task,
          output: logs.join('\n'),
          exitCode: 0,
        };
      }

      if (task === 'generate-intents') {
        log('[pipeline] Generating unverified query intent hypotheses from collected items...');
        const created = await generateDiscoveryIntents(50);
        log(`[pipeline] Intent generation completed: ${created} new intent hypotheses generated.`);

        log('\n[pipeline] Incubating candidates from newly identified intents...');
        const candidates = await incubateCandidatesFromDiscovery(15);
        if (candidates.length > 0) {
          log(`[pipeline] Successfully promoted ${candidates.length} candidates into Candidate Pool:`);
          for (const c of candidates) {
            log(` • [${c.archetype}] ${c.title}`);
          }
        }

        return {
          task,
          output: logs.join('\n'),
          exitCode: 0,
        };
      }

      if (task === 'validate-intents') {
        log('[pipeline] Validating discovery intent hypotheses against search signals...');
        const validated = await validateDiscoveryIntents(5);
        log(`[pipeline] Intent validation completed: ${validated} discovery intents validated.`);
        return {
          task,
          output: logs.join('\n'),
          exitCode: 0,
        };
      }

      if (task === 'run-daily') {
        const obsDate = new Date().toISOString().slice(0, 10);
        log(`[pipeline] Running daily discovery & observation pipeline for ${obsDate}...`);
        const res = await withPipelineTimeout(runDailyPipeline(obsDate), 'Daily pipeline');
        log(`[pipeline] Daily pipeline run complete for ${obsDate}:`);
        log(` - Processed opportunities: ${res.processedOpportunities}`);
        log(` - Ledger Merkle Root: ${res.merkleRoot || 'N/A'}`);
        log(` - Alerts triggered: ${res.alertsTriggered}`);
        return {
          task,
          output: logs.join('\n'),
          exitCode: 0,
        };
      }

      throw AppError.badRequest(`Unknown task: ${task}`);
    } catch (err: any) {
      log(`[pipeline] Execution error: ${err.message || String(err)}`);
      if (err.stack) {
        log(err.stack);
      }
      return {
        task,
        output: logs.join('\n'),
        exitCode: 1,
      };
    }
  }

  /**
   * Retrieves high-level user statistics
   */
  static async getUserStats(): Promise<AdminUserStats> {
    const res = await query<{
      total_users: string;
      active_users: string;
      paid_users: string;
      staff_users: string;
    }>(`
      SELECT
        COUNT(*)::text AS total_users,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END)::text AS active_users,
        COUNT(CASE WHEN tier IN ('PRO', 'TEAM') THEN 1 END)::text AS paid_users,
        COUNT(CASE WHEN role IN ('ADMIN', 'ANALYST') THEN 1 END)::text AS staff_users
      FROM users
    `);
    const r = res.rows[0];
    return {
      totalUsers: parseInt(r?.total_users || '0', 10),
      activeUsers: parseInt(r?.active_users || '0', 10),
      paidUsers: parseInt(r?.paid_users || '0', 10),
      staffUsers: parseInt(r?.staff_users || '0', 10),
    };
  }

  /**
   * Lists users with search, role, tier, and status filtering with pagination
   */
  static async listUsers(options?: {
    userId?: string;
    search?: string;
    role?: string;
    tier?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AdminUserListItem[]; total: number; stats: AdminUserStats }> {
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = Math.max(0, options?.offset || 0);
    const search = options?.search?.trim();

    const conditions: string[] = [];
    const params: any[] = [];

    if (options?.userId) {
      params.push(options.userId);
      conditions.push(`u.id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(
        `(LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.display_name, '')) LIKE $${params.length} OR LOWER(u.id) LIKE $${params.length})`
      );
    }

    if (options?.role && ['USER', 'ANALYST', 'ADMIN', 'SUPPORT'].includes(options.role)) {
      params.push(options.role);
      conditions.push(`u.role = $${params.length}`);
    }

    if (options?.tier && ['FREE', 'PRO', 'TEAM'].includes(options.tier)) {
      params.push(options.tier);
      conditions.push(`u.tier = $${params.length}`);
    }

    if (options?.status && ['ACTIVE', 'SUSPENDED', 'DELETED'].includes(options.status)) {
      params.push(options.status);
      conditions.push(`u.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users u ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listParams = [...params, limit, offset];
    const itemsRes = await query<{
      id: string;
      email: string;
      display_name: string | null;
      avatar_url: string | null;
      role: 'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT';
      tier: 'FREE' | 'PRO' | 'TEAM';
      status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
      created_at: string;
      updated_at: string;
      projects_count: number;
      alerts_count: number;
      api_keys_count: number;
      subscription_plan_code: string | null;
      has_active_subscription: boolean;
    }>(
      `SELECT 
        u.id,
        u.email,
        u.display_name,
        u.avatar_url,
        u.role,
        u.tier,
        u.status,
        u.created_at::text,
        u.updated_at::text,
        COALESCE(p.cnt, 0)::int AS projects_count,
        COALESCE(a.cnt, 0)::int AS alerts_count,
        COALESCE(k.cnt, 0)::int AS api_keys_count,
        s.plan_code AS subscription_plan_code,
        COALESCE(s.status = 'ACTIVE' AND s.current_period_end > NOW(), false) AS has_active_subscription
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS cnt FROM projects GROUP BY user_id
      ) p ON p.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS cnt FROM alert_rules GROUP BY user_id
      ) a ON a.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS cnt FROM api_keys WHERE revoked_at IS NULL GROUP BY user_id
      ) k ON k.user_id = u.id
      LEFT JOIN (
        SELECT DISTINCT ON (user_id) user_id, plan_code, status, current_period_end
        FROM subscriptions
        ORDER BY user_id, created_at DESC
      ) s ON s.user_id = u.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const stats = await this.getUserStats();

    return {
      total,
      stats,
      items: itemsRes.rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        role: r.role,
        tier: r.tier,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        projectsCount: r.projects_count,
        alertsCount: r.alerts_count,
        apiKeysCount: r.api_keys_count,
        subscriptionPlanCode: r.subscription_plan_code,
        hasActiveSubscription: r.has_active_subscription,
      })),
    };
  }

  /**
   * Retrieves a single user by ID with aggregated details
   */
  static async getUserById(userId: string): Promise<AdminUserListItem | null> {
    const res = await this.listUsers({ userId, limit: 1 });
    return res.items[0] || null;
  }

  /**
   * Defense-in-depth: verify that the caller of a privileged user-management
   * operation is an ACTIVE ADMIN. Passing `null` is only permitted for the
   * one-time bootstrap of the very first administrator (i.e. when no active
   * ADMIN exists yet). ANALYST / SUPPORT / USER callers are always rejected.
   */
  private static async assertAdminCaller(callerUserId: string | null): Promise<void> {
    if (callerUserId) {
      const res = await query<{ role: string; status: string }>(
        `SELECT role, status FROM users WHERE id = $1`,
        [callerUserId]
      );
      const row = res.rows[0];
      if (!row || row.status !== 'ACTIVE' || row.role !== 'ADMIN') {
        throw AppError.forbidden('Only an active Administrator can perform this action.');
      }
      return;
    }
    // Bootstrap path: allowed only while no active ADMIN exists.
    const adminRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'`
    );
    if (parseInt(adminRes.rows[0]?.count || '0', 10) > 0) {
      throw AppError.forbidden('Administrator privileges required.');
    }
  }

  /**
   * Updates user role, tier, or status with security validations
   */
  static async updateUser(
    adminUserId: string,
    targetUserId: string,
    updates: {
      role?: 'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT';
      tier?: 'FREE' | 'PRO' | 'TEAM';
      status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
    }
  ): Promise<AdminUserListItem> {
    await this.assertAdminCaller(adminUserId);

    const curRes = await query<{
      id: string;
      email: string;
      role: string;
      tier: string;
      status: string;
    }>(`SELECT id, email, role, tier, status FROM users WHERE id = $1`, [targetUserId]);

    if (curRes.rows.length === 0) {
      throw AppError.notFound('Target user not found.');
    }
    const current = curRes.rows[0];

    // Validate Role change
    if (updates.role && updates.role !== current.role) {
      if (current.role === 'ADMIN' && updates.role !== 'ADMIN') {
        const adminCountRes = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'`
        );
        const adminCount = parseInt(adminCountRes.rows[0]?.count || '0', 10);
        if (adminCount <= 1) {
          throw AppError.badRequest('Cannot demote the only remaining active Administrator.');
        }
      }
    }

    // Validate Status change
    if (updates.status && updates.status !== current.status) {
      if (adminUserId === targetUserId && updates.status !== 'ACTIVE') {
        throw AppError.badRequest('You cannot suspend or deactivate your own account.');
      }
    }

    // Perform update
    await query(
      `UPDATE users SET
        role = COALESCE($1, role),
        tier = COALESCE($2, tier),
        status = COALESCE($3, status),
        updated_at = NOW()
       WHERE id = $4`,
      [updates.role || null, updates.tier || null, updates.status || null, targetUserId]
    );

    // If status became SUSPENDED or DELETED, terminate all active sessions immediately
    if (updates.status && updates.status !== 'ACTIVE') {
      await query(`DELETE FROM sessions WHERE user_id = $1`, [targetUserId]);
    }

    const refreshed = await this.getUserById(targetUserId);
    if (!refreshed) {
      throw AppError.notFound('Failed to fetch updated user.');
    }
    return refreshed;
  }

  /**
   * Resets a user's password (manual or auto-generated)
   */
  static async resetUserPassword(
    callerUserId: string | null,
    targetUserId: string,
    newPassword?: string
  ): Promise<{ temporaryPassword: string }> {
    await this.assertAdminCaller(callerUserId);

    const userRes = await query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = $1`,
      [targetUserId]
    );
    if (userRes.rows.length === 0) {
      throw AppError.notFound('Target user not found.');
    }
    const user = userRes.rows[0];

    const tempPassword =
      newPassword && newPassword.trim().length >= 8
        ? newPassword.trim()
        : `Emd_${randomBytes(4).toString('hex')}!2026`;

    const passwordHash = AuthService.hashPassword(tempPassword);

    await transaction(async (client) => {
      // Upsert credentials account
      await client.query(
        `INSERT INTO accounts (id, user_id, type, provider, provider_account_id, refresh_token)
         VALUES ($1, $2, 'credentials', 'credentials', $3, $4)
         ON CONFLICT (provider, provider_account_id) DO UPDATE SET
           refresh_token = $4`,
        [`acc_${user.id}`, user.id, user.email, passwordHash]
      );

      // Kill all active sessions to force re-login
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
    });

    return { temporaryPassword: tempPassword };
  }

  /**
   * Creates a new user directly by Administrator
   */
  static async createUserByAdmin(
    callerUserId: string | null,
    input: {
    email: string;
    password?: string;
    displayName?: string;
    role?: 'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT';
    tier?: 'FREE' | 'PRO' | 'TEAM';
  }): Promise<{ user: AdminUserListItem; temporaryPassword: string }> {
    await this.assertAdminCaller(callerUserId);

    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw AppError.badRequest('Valid email address is required.');
    }

    const existing = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      throw AppError.conflict('A user with this email address already exists.');
    }

    const tempPassword =
      input.password && input.password.trim().length >= 8
        ? input.password.trim()
        : `Emd_${randomBytes(4).toString('hex')}!2026`;

    const userId = `usr_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
    const passwordHash = AuthService.hashPassword(tempPassword);
    const displayName = input.displayName || email.split('@')[0];
    const role = input.role || 'USER';
    const tier = input.tier || 'FREE';

    await transaction(async (client) => {
      // 1. Insert user
      await client.query(
        `INSERT INTO users (id, email, display_name, role, tier, status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
        [userId, email, displayName, role, tier]
      );

      // 2. Insert credentials account
      await client.query(
        `INSERT INTO accounts (id, user_id, type, provider, provider_account_id, refresh_token)
         VALUES ($1, $2, 'credentials', 'credentials', $3, $4)`,
        [`acc_${userId}`, userId, email, passwordHash]
      );

      // 3. Insert default preferences
      await client.query(
        `INSERT INTO user_preferences (user_id, ui_locale, preferred_markets, preferred_build_types)
         VALUES ($1, 'zh-CN', '{"US"}', '{"LIGHTWEIGHT_TOOL","MICRO_SAAS"}')`,
        [userId]
      );
    });

    const refreshed = await this.getUserById(userId);
    if (!refreshed) {
      throw AppError.notFound('Failed to fetch newly created user.');
    }
    return {
      user: refreshed,
      temporaryPassword: tempPassword,
    };
  }
}
