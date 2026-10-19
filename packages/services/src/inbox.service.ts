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
  /** 发现阶段够用的证据摘要：弱页、已验证定价、需求观测。 */
  evidence: {
    weakResultCount: number;
    weakResults: Array<{ domain: string; url: string; rank: number }>;
    pricedDomains: string[];
    observationDays: number;
    whyNow: string | null;
  };
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
          AND COALESCE(o.is_demo, false) = false
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
              c.why_now_summary,
              COALESCE(obs.days_count, 0)::int AS observation_days,
              COALESCE(weak.weak_count, 0)::int AS weak_result_count,
              COALESCE(weak.weak_results, '[]'::json) AS weak_results,
              COALESCE(priced.domains, '[]'::json) AS priced_domains
         FROM opportunities o
         LEFT JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
         LEFT JOIN queries q ON q.id = oq.query_id
         LEFT JOIN opportunity_cards c ON c.opportunity_id = o.id
         LEFT JOIN (
           SELECT query_id, COUNT(DISTINCT observed_date) AS days_count
             FROM autocomplete_observations
            GROUP BY query_id
         ) obs ON obs.query_id = q.id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS weak_count,
                  json_agg(json_build_object('domain', sr.domain, 'url', sr.url, 'rank', sr.rank)
                           ORDER BY sr.rank) AS weak_results
             FROM (
               SELECT sr.domain, sr.url, sr.rank
                 FROM serp_results sr
                 JOIN serp_snapshots ss ON ss.id = sr.serp_snapshot_id
                WHERE ss.query_id = q.id AND sr.is_weak = true
                ORDER BY ss.obs_date DESC, sr.rank
                LIMIT 3
             ) sr
         ) weak ON true
         LEFT JOIN LATERAL (
           SELECT json_agg(DISTINCT e.domain) AS domains
             FROM evidence e
            WHERE e.opportunity_id = o.id
              AND e.source_type = 'PAID_TIER_OBSERVED'
              AND e.domain IS NOT NULL
         ) priced ON true
        WHERE o.status = 'CANDIDATE'
          AND COALESCE(o.is_demo, false) = false
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
        evidence: {
          weakResultCount: row.weak_result_count,
          weakResults: row.weak_results ?? [],
          pricedDomains: row.priced_domains ?? [],
          observationDays: row.observation_days,
          whyNow: row.why_now_summary ?? row.candidate_reason ?? null,
        },
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
