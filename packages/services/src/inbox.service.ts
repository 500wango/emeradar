import { query } from '@emeradar/db';

/**
 * Opportunity Inbox — 早期信号层（不是已发布裁决）。
 *
 * 只读 `status='CANDIDATE'` 的机会：它们还没通过 BUILD_NOW / EARLY_BET 的发布门，
 * 但已经足够让用户决定"值不值得继续看"。标签必须是 EARLY_SIGNAL，不能伪装成裁决。
 *
 * Free 只取 3 条，付费取 20 条；已给过负面反馈的候选不再重复出现。
 */
export type InboxFeedbackReason =
  | 'INTERESTED'
  | 'SAVED'
  | 'NOT_OPPORTUNITY'
  | 'ALREADY_BUILT'
  | 'CANNOT_BUILD';

export interface InboxItem {
  opportunityId: string;
  slug: string;
  title: string;
  primaryQuery: string | null;
  marketCountry: string;
  researchLanguage: string;
  firstObservedDate: string | null;
  discoverySource: string | null;
  candidateReason: string | null;
  observationDays: number;
  recommendedArchetype: string;
  executionClass: string;
  /** 这是早期信号，不是裁决。 */
  stage: 'EARLY_SIGNAL';
}

export interface InboxResponse {
  items: InboxItem[];
  total: number;
  freeQuota: number | null;
  isPaid: boolean;
}

const NEGATIVE_REASONS: InboxFeedbackReason[] = ['NOT_OPPORTUNITY', 'ALREADY_BUILT', 'CANNOT_BUILD'];

export class InboxService {
  static async list(
    userId: string,
    isPaid: boolean,
    limit?: number
  ): Promise<InboxResponse> {
    const quota = isPaid ? null : 3;
    const take = Math.max(1, Math.min(isPaid ? 50 : 3, limit ?? (isPaid ? 20 : 3)));

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM opportunities o
        WHERE o.status = 'CANDIDATE'
          AND NOT EXISTS (
            SELECT 1 FROM opportunity_feedback f
             WHERE f.user_id = $1
               AND f.opportunity_id = o.id
               AND f.reason = ANY($2::text[])
          )`,
      [userId, NEGATIVE_REASONS]
    );
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

    const res = await query<any>(
      `SELECT o.id, o.slug, o.title, o.market_country, o.research_language,
              o.first_observed_date::text AS first_observed_date,
              o.discovery_source, o.candidate_reason,
              o.recommended_archetype, o.execution_class,
              q.query_text AS primary_query,
              COALESCE(obs.days_count, 0)::int AS observation_days
         FROM opportunities o
         LEFT JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
         LEFT JOIN queries q ON q.id = oq.query_id
         LEFT JOIN (
           SELECT query_id, COUNT(DISTINCT observed_date) AS days_count
             FROM autocomplete_observations
            GROUP BY query_id
         ) obs ON obs.query_id = q.id
        WHERE o.status = 'CANDIDATE'
          AND NOT EXISTS (
            SELECT 1 FROM opportunity_feedback f
             WHERE f.user_id = $1
               AND f.opportunity_id = o.id
               AND f.reason = ANY($2::text[])
          )
        ORDER BY o.first_observed_date DESC NULLS LAST, o.created_at DESC
        LIMIT $3`,
      [userId, NEGATIVE_REASONS, take]
    );

    return {
      items: res.rows.map((row) => ({
        opportunityId: row.id,
        slug: row.slug,
        title: row.title,
        primaryQuery: row.primary_query ?? null,
        marketCountry: row.market_country,
        researchLanguage: row.research_language,
        firstObservedDate: row.first_observed_date,
        discoverySource: row.discovery_source,
        candidateReason: row.candidate_reason,
        observationDays: row.observation_days,
        recommendedArchetype: row.recommended_archetype,
        executionClass: row.execution_class,
        stage: 'EARLY_SIGNAL' as const,
      })),
      total,
      freeQuota: quota,
      isPaid,
    };
  }

  static async recordFeedback(
    userId: string,
    opportunityId: string,
    reason: InboxFeedbackReason,
    note?: string | null
  ): Promise<void> {
    await query(
      `INSERT INTO opportunity_feedback (user_id, opportunity_id, reason, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, opportunity_id, reason)
       DO UPDATE SET note = COALESCE(EXCLUDED.note, opportunity_feedback.note)`,
      [userId, opportunityId, reason, note?.trim() || null]
    );
  }
}
