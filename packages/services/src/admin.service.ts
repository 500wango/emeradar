import { query, transaction } from '@emeradar/db';
import { AppError } from '@emeradar/core';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

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
             opportunity_id, slug, title, primary_query, market_country, research_language,
             verdict, lifecycle, recommended_archetype, execution_class,
             d_basis_points, m_basis_points, w_basis_points,
             d_band, m_band, w_band, confidence,
             why_now_summary, top_idea, published_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             'BUILD_NOW', 'EARLY_WINDOW', $7, $8,
             8000, 7500, 7800,
             'HIGH', 'MEDIUM', 'HIGH', 'HIGH',
             $9, $10, NOW()
           )
           ON CONFLICT (opportunity_id) DO UPDATE SET
             verdict = 'BUILD_NOW',
             published_at = NOW()`,
          [
            opp.id,
            opp.slug,
            opp.title,
            primaryQuery,
            opp.market_country,
            opp.research_language,
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
   */
  static async triggerTask(task: 'discover' | 'generate-intents' | 'validate-intents' | 'run-daily'): Promise<{
    task: string;
    output: string;
    exitCode: number;
  }> {
    let scriptCommand = '';
    switch (task) {
      case 'discover':
        scriptCommand = 'pnpm --filter @emeradar/worker discover';
        break;
      case 'generate-intents':
        scriptCommand = 'pnpm --filter @emeradar/worker generate-intents 50';
        break;
      case 'validate-intents':
        scriptCommand = 'pnpm --filter @emeradar/worker validate-intents 5';
        break;
      case 'run-daily':
        scriptCommand = 'pnpm --filter @emeradar/worker run-daily';
        break;
      default:
        throw AppError.badRequest(`Unknown task: ${task}`);
    }

    try {
      const { stdout, stderr } = await execAsync(scriptCommand, {
        cwd: process.cwd(),
        timeout: 60000,
      });
      return {
        task,
        output: (stdout || '') + (stderr ? `\nSTDERR:\n${stderr}` : ''),
        exitCode: 0,
      };
    } catch (err: any) {
      return {
        task,
        output: err.stdout || err.stderr || err.message,
        exitCode: err.code || 1,
      };
    }
  }
}
