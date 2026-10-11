import { query } from '@emeradar/db';
import { EmeradarError, ErrorCode, Verdict, BuildArchetype, ExecutionClass } from '@emeradar/core';
import { deriveBasisState } from '@emeradar/report';

export interface FeedCardFilterOptions {
  verdict?: Verdict;
  /** Match any of these verdicts. Takes precedence over `verdict` when set. */
  verdicts?: Verdict[];
  archetype?: BuildArchetype;
  executionClass?: ExecutionClass;
  minD?: number;
  search?: string;
  limit?: number;
  offset?: number;
  /** Hide decisions newer than this many days. 0 shows the realtime published feed. */
  minAgeDays?: number;
}

export interface FeedCardItem {
  opportunityId: string;
  slug: string;
  title: string;
  primaryQuery: string;
  verdict: Verdict;
  lifecycle: string;
  dBasisPoints: number;
  mBasisPoints: number;
  wBasisPoints: number;
  dBand: string;
  mBand: string;
  wBand: string;
  confidence: string;
  recommendedArchetype: BuildArchetype;
  executionClass: ExecutionClass;
  whyNowSummary: string;
  topIdea: string;
  firstObservedAt: string;
  queryVelocity: number;
  featuredEvidenceSnippet?: string;
  marketCountry: string;
  researchLanguage: string;
  firstObservedDate?: string;
  discoverySource?: string | null;
  candidateReason?: string | null;
  observationDays?: number;
  serpObservationDays?: number;
  claimsCount?: number;
  maxClaims?: number;
  isCrowdedLocked?: boolean;
  /**
   * 判定依据是否已留存于账本（v2 起）。false 表示这是早于该功能的存量记录，
   * 界面必须如实说明，而不是把"账本没记"显示成"没有负面信号"。
   */
  basisRetained?: boolean;
  /** 去抖前的原始裁决；依据未留存时为 undefined。 */
  rawVerdict?: Verdict;
  /** 本期命中的评分标志；未留存时为 undefined —— 与"本期确实没有标志"（空数组）不是一回事。 */
  flags?: string[];
  /** 账本规则轨迹，用于识别补偿判定（RULE_BUILD_NOW_COMPENSATED）。 */
  rulesTriggered?: string[];
}

export interface FeedResponse {
  items: FeedCardItem[];
  total: number;
  hasMore: boolean;
  activeFilters: FeedCardFilterOptions;
  zeroStateAlternativeCount?: number;
}

export interface CompareOpportunityItem {
  opportunityId: string;
  slug: string;
  title: string;
  primaryQuery: string;
  verdict: Verdict;
  dBand: string;
  mBand: string;
  wBand: string;
  confidence: string;
  executionClass: ExecutionClass;
  claimsCount: number;
  maxClaims: number;
  killCriteriaTotal: number;
  killCriteriaTriggered: number;
  marketCountry: string;
  researchLanguage: string;
}

export interface DiscoveryFeedItem {
  id: string;
  title: string;
  sourceUrl: string;
  provider: string;
  sourcePublishedAt?: string;
  firstCollectedAt: string;
  excerpt?: string;
  intents: Array<{ kind: string; queryHypothesis: string; status: string }>;
  validation?: {
    autocompleteStatus: string;
    serpStatus: string;
    supplyGapStatus: string;
    supplyGapNote?: string;
    specialistResultCount?: number;
  };
}

export interface ExperimentFeedItem {
  id: string;
  discoveryItemId: string;
  discoveryIntentId: string;
  title: string;
  coreJob: string;
  recommendedPageShape: string;
  minimumFeature: string;
  successSignal: string;
  abandonCondition: string;
  status: string;
  sourceTitle: string;
  sourceUrl: string;
  queryHypothesis: string;
}

export class OpportunityService {
  static async listExperimentCards(limit = 12): Promise<ExperimentFeedItem[]> {
    const result = await query<any>(
      `SELECT e.id, e.discovery_item_id, e.discovery_intent_id, e.title, e.core_job,
              e.recommended_page_shape, e.minimum_feature, e.success_signal,
              e.abandon_condition, e.status, d.title AS source_title, d.source_url,
              i.query_hypothesis
       FROM experiment_cards e
       JOIN discovery_items d ON d.id = e.discovery_item_id
       JOIN discovery_intents i ON i.id = e.discovery_intent_id
       WHERE e.status = 'PROPOSED'
       ORDER BY e.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      discoveryItemId: row.discovery_item_id,
      discoveryIntentId: row.discovery_intent_id,
      title: row.title,
      coreJob: row.core_job,
      recommendedPageShape: row.recommended_page_shape,
      minimumFeature: row.minimum_feature,
      successSignal: row.success_signal,
      abandonCondition: row.abandon_condition,
      status: row.status,
      sourceTitle: row.source_title,
      sourceUrl: row.source_url,
      queryHypothesis: row.query_hypothesis,
    }));
  }

  static async listDiscoveryItems(limit = 12): Promise<DiscoveryFeedItem[]> {
    const result = await query<any>(
      `SELECT d.id, d.title, d.source_url, d.provider, d.source_published_at, d.first_collected_at,
              d.excerpt,
              (SELECT v.autocomplete_status FROM discovery_validations v JOIN discovery_intents vi ON vi.id = v.discovery_intent_id WHERE vi.discovery_item_id = d.id ORDER BY v.observed_date DESC LIMIT 1) AS autocomplete_status,
              (SELECT v.serp_status FROM discovery_validations v JOIN discovery_intents vi ON vi.id = v.discovery_intent_id WHERE vi.discovery_item_id = d.id ORDER BY v.observed_date DESC LIMIT 1) AS serp_status,
              (SELECT v.supply_gap_status FROM discovery_validations v JOIN discovery_intents vi ON vi.id = v.discovery_intent_id WHERE vi.discovery_item_id = d.id ORDER BY v.observed_date DESC LIMIT 1) AS supply_gap_status,
              (SELECT v.supply_gap_note FROM discovery_validations v JOIN discovery_intents vi ON vi.id = v.discovery_intent_id WHERE vi.discovery_item_id = d.id ORDER BY v.observed_date DESC LIMIT 1) AS supply_gap_note,
              (SELECT v.specialist_result_count FROM discovery_validations v JOIN discovery_intents vi ON vi.id = v.discovery_intent_id WHERE vi.discovery_item_id = d.id ORDER BY v.observed_date DESC LIMIT 1) AS specialist_result_count,
              COALESCE(json_agg(json_build_object(
                'kind', i.intent_kind, 'queryHypothesis', i.query_hypothesis, 'status', i.status
              ) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS intents
       FROM discovery_items d
       LEFT JOIN discovery_intents i ON i.discovery_item_id = d.id
       GROUP BY d.id
       ORDER BY COALESCE(d.source_published_at, d.first_collected_at) DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      sourceUrl: row.source_url,
      provider: row.provider,
      sourcePublishedAt: row.source_published_at ?? undefined,
      firstCollectedAt: row.first_collected_at,
      excerpt: row.excerpt ?? undefined,
      intents: row.intents ?? [],
      validation: row.serp_status || row.autocomplete_status ? {
        autocompleteStatus: row.autocomplete_status,
        serpStatus: row.serp_status,
        supplyGapStatus: row.supply_gap_status,
        supplyGapNote: row.supply_gap_note ?? undefined,
        specialistResultCount: row.specialist_result_count ?? undefined,
      } : undefined,
    }));
  }
  /**
   * Query feed cards with filtering, sorting, and pagination
   */
  static async listFeedCards(options: FeedCardFilterOptions = {}): Promise<FeedResponse> {
    const {
      verdict,
      verdicts,
      archetype,
      executionClass,
      minD,
      search,
      limit = 20,
      offset = 0,
      minAgeDays = 0,
    } = options;

    const conditions: string[] = [`o.status = 'TRACKED'`];
    const params: any[] = [];
    let paramIdx = 1;
    if (minAgeDays > 0) {
      conditions.push(`c.first_observed_at <= NOW() - ($${paramIdx++} || ' days')::interval`);
      params.push(String(minAgeDays));
    }

    if (verdicts && verdicts.length > 0) {
      conditions.push(`c.verdict = ANY($${paramIdx++})`);
      params.push(verdicts);
    } else if (verdict) {
      conditions.push(`c.verdict = $${paramIdx++}`);
      params.push(verdict);
    }
    if (archetype) {
      conditions.push(`c.recommended_archetype = $${paramIdx++}`);
      params.push(archetype);
    }
    if (executionClass) {
      conditions.push(`c.execution_class = $${paramIdx++}`);
      params.push(executionClass);
    }
    if (minD !== undefined) {
      conditions.push(`c.d_basis_points >= $${paramIdx++}`);
      params.push(minD);
    }
    if (search && search.trim().length > 0) {
      conditions.push(
        `(o.title ILIKE $${paramIdx} OR c.primary_query ILIKE $${paramIdx} OR c.why_now_summary ILIKE $${paramIdx})`
      );
      params.push(`%${search.trim()}%`);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    // Count query
    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM opportunity_cards c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

    // Items query (sorted by D-score descending by default)
    const itemsRes = await query<any>(
      `SELECT 
        c.opportunity_id,
        c.slug,
        o.title,
        c.primary_query,
        c.verdict,
        c.lifecycle,
        c.d_basis_points,
        c.m_basis_points,
        c.w_basis_points,
        c.d_band,
        c.m_band,
        c.w_band,
        c.confidence,
        c.recommended_archetype,
        c.execution_class,
        c.why_now_summary,
        c.top_idea,
        c.first_observed_at,
        c.query_velocity,
        c.featured_evidence_snippet,
        o.market_country,
        o.research_language,
        o.first_observed_date,
        o.discovery_source,
        o.candidate_reason,
        COALESCE((SELECT COUNT(DISTINCT observed_date) FROM autocomplete_observations ao JOIN opportunity_queries oq2 ON oq2.query_id = ao.query_id WHERE oq2.opportunity_id = o.id), 0)::int AS observation_days,
        COALESCE((SELECT COUNT(DISTINCT ss.obs_date) FROM serp_snapshots ss JOIN opportunity_queries oq3 ON oq3.query_id = ss.query_id WHERE oq3.opportunity_id = o.id), 0)::int AS serp_observation_days,
        COALESCE((SELECT COUNT(*) FROM projects pr WHERE pr.opportunity_id = o.id AND pr.status != 'ABANDONED'), 0)::int AS claims_count,
        lv.raw_verdict,
        lv.flags,
        lv.hash_version,
        lv.explanation->'rulesTriggered' AS rules_triggered
       FROM opportunity_cards c
       JOIN opportunities o ON o.id = c.opportunity_id
       LEFT JOIN LATERAL (
         SELECT v.raw_verdict, v.flags, v.explanation, v.hash_version
         FROM verdicts v
         WHERE v.opportunity_id = c.opportunity_id
         ORDER BY v.obs_date DESC
         LIMIT 1
       ) lv ON TRUE
       WHERE ${whereClause}
       ORDER BY c.d_basis_points DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    const items: FeedCardItem[] = itemsRes.rows.map((r) => ({
      opportunityId: r.opportunity_id,
      slug: r.slug,
      title: r.title,
      primaryQuery: r.primary_query,
      verdict: r.verdict,
      lifecycle: r.lifecycle,
      dBasisPoints: r.d_basis_points,
      mBasisPoints: r.m_basis_points,
      wBasisPoints: r.w_basis_points,
      dBand: r.d_band,
      mBand: r.m_band,
      wBand: r.w_band,
      confidence: r.confidence,
      recommendedArchetype: r.recommended_archetype,
      executionClass: r.execution_class,
      whyNowSummary: r.why_now_summary,
      topIdea: r.top_idea,
      firstObservedAt: r.first_observed_at,
      queryVelocity: parseFloat(r.query_velocity),
      featuredEvidenceSnippet: r.featured_evidence_snippet,
      marketCountry: r.market_country,
      researchLanguage: r.research_language,
      firstObservedDate: r.first_observed_date,
      discoverySource: r.discovery_source,
      candidateReason: r.candidate_reason,
      observationDays: r.observation_days,
      serpObservationDays: r.serp_observation_days,
      claimsCount: r.claims_count ?? 0,
      maxClaims: 5,
      isCrowdedLocked: (r.claims_count ?? 0) >= 5,
      // 判定依据：与报告共用同一套留存口径，避免两处对"什么算留存"各执一词。
      basisRetained: deriveBasisState(r) !== 'NOT_RETAINED',
      rawVerdict: (r.raw_verdict as Verdict | null) ?? undefined,
      flags: (r.flags as string[] | null) ?? undefined,
      rulesTriggered: Array.isArray(r.rules_triggered) ? (r.rules_triggered as string[]) : undefined,
    }));

    // Zero-state relaxed count fallback if 0 items found
    let zeroStateAlternativeCount: number | undefined;
    if (total === 0 && (verdict || archetype || executionClass)) {
      const altRes = await query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM opportunity_cards c
         JOIN opportunities o ON o.id = c.opportunity_id
         WHERE o.status = 'TRACKED'`
      );
      zeroStateAlternativeCount = parseInt(altRes.rows[0]?.count ?? '0', 10);
    }

    return {
      items,
      total,
      hasMore: offset + items.length < total,
      activeFilters: options,
      zeroStateAlternativeCount,
    };
  }

  /**
   * Live observations that have not passed the publication gate.
   * These rows are fetched from source APIs and are not build decisions.
   */
  static async listLiveObservations(options: { limit?: number } = {}): Promise<FeedCardItem[]> {
    const limit = options.limit ?? 20;
    const itemsRes = await query<any>(
      `SELECT
        c.opportunity_id,
        c.slug,
        o.title,
        c.primary_query,
        c.verdict,
        c.lifecycle,
        c.d_basis_points,
        c.m_basis_points,
        c.w_basis_points,
        c.d_band,
        c.m_band,
        c.w_band,
        c.confidence,
        c.recommended_archetype,
        c.execution_class,
        c.why_now_summary,
        c.top_idea,
        c.first_observed_at,
        c.query_velocity,
        c.featured_evidence_snippet,
        o.market_country,
        o.research_language,
        o.first_observed_date,
        o.discovery_source,
        o.candidate_reason,
        COALESCE((SELECT COUNT(DISTINCT observed_date) FROM autocomplete_observations ao JOIN opportunity_queries oq2 ON oq2.query_id = ao.query_id WHERE oq2.opportunity_id = o.id), 0)::int AS observation_days,
        COALESCE((SELECT COUNT(DISTINCT ss.obs_date) FROM serp_snapshots ss JOIN opportunity_queries oq3 ON oq3.query_id = ss.query_id WHERE oq3.opportunity_id = o.id), 0)::int AS serp_observation_days,
        COALESCE((SELECT COUNT(*) FROM projects pr WHERE pr.opportunity_id = o.id AND pr.status != 'ABANDONED'), 0)::int AS claims_count
       FROM opportunity_cards c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE o.status = 'CANDIDATE'
       ORDER BY c.first_observed_at DESC
       LIMIT $1`,
      [limit]
    );

    return itemsRes.rows.map((r) => ({
      opportunityId: r.opportunity_id,
      slug: r.slug,
      title: r.title,
      primaryQuery: r.primary_query,
      verdict: r.verdict,
      lifecycle: r.lifecycle,
      dBasisPoints: r.d_basis_points,
      mBasisPoints: r.m_basis_points,
      wBasisPoints: r.w_basis_points,
      dBand: r.d_band,
      mBand: r.m_band,
      wBand: r.w_band,
      confidence: r.confidence,
      recommendedArchetype: r.recommended_archetype,
      executionClass: r.execution_class,
      whyNowSummary: r.why_now_summary,
      topIdea: r.top_idea,
      firstObservedAt: r.first_observed_at,
      queryVelocity: parseFloat(r.query_velocity),
      featuredEvidenceSnippet: r.featured_evidence_snippet,
      marketCountry: r.market_country,
      researchLanguage: r.research_language,
      firstObservedDate: r.first_observed_date,
      discoverySource: r.discovery_source,
      candidateReason: r.candidate_reason,
      observationDays: r.observation_days,
      serpObservationDays: r.serp_observation_days,
      claimsCount: r.claims_count ?? 0,
      maxClaims: 5,
      isCrowdedLocked: (r.claims_count ?? 0) >= 5,
    }));
  }

  /** Compare published opportunities using the same delayed feed boundary as the caller. */
  static async compareOpportunities(
    ids: string[],
    options: { minAgeDays?: number } = {},
  ): Promise<CompareOpportunityItem[]> {
    const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (normalizedIds.length < 2 || normalizedIds.length > 3) {
      throw new EmeradarError(
        ErrorCode.VALIDATION_ERROR,
        'Compare requires between 2 and 3 opportunity ids.',
        400,
      );
    }

    const params: any[] = [normalizedIds];
    const conditions = [
      `o.id = ANY($1::text[])`,
      `o.status = 'TRACKED'`,
      `c.verdict IN ('BUILD_NOW', 'EARLY_BET')`,
      `c.confidence <> 'LOW'`,
    ];
    if (options.minAgeDays && options.minAgeDays > 0) {
      params.push(String(options.minAgeDays));
      conditions.push(`c.first_observed_at <= NOW() - ($${params.length} || ' days')::interval`);
    }

    const result = await query<any>(
      `SELECT o.id AS opportunity_id, o.slug, o.title, o.market_country, o.research_language,
              c.primary_query, c.verdict, c.d_band, c.m_band, c.w_band,
              c.confidence, c.execution_class,
              COALESCE((SELECT COUNT(*) FROM projects p
                        WHERE p.opportunity_id = o.id AND p.status <> 'ABANDONED'), 0)::int AS claims_count,
              COALESCE((SELECT COUNT(*) FROM kill_criteria k WHERE k.opportunity_id = o.id), 0)::int AS kill_criteria_total,
              COALESCE((SELECT COUNT(*) FROM kill_criteria k
                        WHERE k.opportunity_id = o.id AND k.status = 'TRIGGERED'), 0)::int AS kill_criteria_triggered
       FROM opportunities o
       JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY array_position($1::text[], o.id) ASC`,
      params,
    );

    if (result.rows.length !== normalizedIds.length) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        'One or more selected opportunities are not available for comparison.',
        404,
      );
    }

    return result.rows.map((row) => ({
      opportunityId: row.opportunity_id,
      slug: row.slug,
      title: row.title,
      primaryQuery: row.primary_query,
      verdict: row.verdict,
      dBand: row.d_band,
      mBand: row.m_band,
      wBand: row.w_band,
      confidence: row.confidence,
      executionClass: row.execution_class,
      claimsCount: row.claims_count ?? 0,
      maxClaims: 5,
      killCriteriaTotal: row.kill_criteria_total ?? 0,
      killCriteriaTriggered: row.kill_criteria_triggered ?? 0,
      marketCountry: row.market_country,
      researchLanguage: row.research_language,
    }));
  }

  /**
   * Get full 9-section opportunity decision workspace details
   */
  static async getOpportunityDetail(
    idOrSlug: string,
    options: { minAgeDays?: number } = {}
  ): Promise<any> {
    // Only published decisions are addressable. Without this a caller who knows
    // (or guesses) a slug could read a CANDIDATE record the feed deliberately
    // withholds, and a delayed-feed plan could read a fresh record ahead of its
    // feed boundary.
    const conditions = [`(o.id = $1 OR o.slug = $1)`, `o.status = 'TRACKED'`];
    const params: any[] = [idOrSlug];
    if (options.minAgeDays && options.minAgeDays > 0) {
      params.push(String(options.minAgeDays));
      conditions.push(`c.first_observed_at <= NOW() - ($${params.length} || ' days')::interval`);
    }

    const oppRes = await query<any>(
      `SELECT o.*, 
        c.primary_query, c.verdict, c.lifecycle,
        c.d_basis_points, c.m_basis_points, c.w_basis_points,
        c.d_band, c.m_band, c.w_band, c.confidence,
        c.why_now_summary, c.top_idea, c.query_velocity
       FROM opportunities o
       JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE ${conditions.join(' AND ')}`,
      params
    );

    if (oppRes.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Opportunity not found: ${idOrSlug}`,
        404
      );
    }

    const opp = oppRes.rows[0];

    // Queries in cluster
    const queriesRes = await query<any>(
      `SELECT q.id, q.query_text, q.tier, oq.role
       FROM opportunity_queries oq
       JOIN queries q ON q.id = oq.query_id
       WHERE oq.opportunity_id = $1
       ORDER BY oq.role ASC, q.tier ASC`,
      [opp.id]
    );

    // Latest SERP snapshot and results
    const serpRes = await query<any>(
      `SELECT s.id as serp_snapshot_id, s.weak_result_ratio,
              r.rank, r.url, r.domain, r.title, r.snippet, r.result_type, r.is_weak, r.weakness_type
       FROM serp_snapshots s
       JOIN serp_results r ON r.serp_snapshot_id = s.id
       JOIN opportunity_queries oq ON oq.query_id = s.query_id AND oq.role = 'PRIMARY'
       WHERE oq.opportunity_id = $1 AND s.obs_date = (
         SELECT MAX(s2.obs_date) FROM serp_snapshots s2
         JOIN opportunity_queries oq2 ON oq2.query_id = s2.query_id AND oq2.opportunity_id = $1 AND oq2.role = 'PRIMARY'
       )
       ORDER BY r.rank ASC`,
      [opp.id]
    );

    // Evidence items
    const evidenceRes = await query<any>(
      `SELECT id, evidence_class, source_type, domain, title, snippet, payload, observed_at
       FROM evidence
       WHERE opportunity_id = $1
       ORDER BY observed_at DESC`,
      [opp.id]
    );

    const commercialRes = await query<any>(
      `SELECT cs.commercial_stage,
              COALESCE(jsonb_array_length(cs.pricing_plans), 0)::int AS plans_count,
              cs.payment_gateways
       FROM commercial_snapshots cs
       JOIN commercial_targets ct ON ct.id = cs.commercial_target_id
       WHERE EXISTS (
         SELECT 1 FROM evidence e
         WHERE e.opportunity_id = $1
           AND e.domain = ct.domain
           AND e.observed_at::date = cs.obs_date
       )
         AND cs.obs_date = (
         SELECT MAX(cs2.obs_date)
         FROM commercial_snapshots cs2
         JOIN commercial_targets ct2 ON ct2.id = cs2.commercial_target_id
         WHERE EXISTS (
           SELECT 1 FROM evidence e2
           WHERE e2.opportunity_id = $1
             AND e2.domain = ct2.domain
             AND e2.observed_at::date = cs2.obs_date
         )
       )
       ORDER BY cs.created_at DESC`,
      [opp.id]
    );
    const commercialProof = commercialRes.rows.reduce(
      (acc, row) => ({
        stage: acc.stage === 'NONE' ? row.commercial_stage : acc.stage,
        plansCount: acc.plansCount + Number(row.plans_count || 0),
        gateways: [...new Set([...acc.gateways, ...(row.payment_gateways || [])])],
      }),
      { stage: 'NONE', plansCount: 0, gateways: [] as string[] }
    );

    // Kill criteria
    const kcRes = await query<any>(
      `SELECT id, rule_code, description, status, triggered_at
       FROM kill_criteria
       WHERE opportunity_id = $1
       ORDER BY rule_code ASC`,
      [opp.id]
    );

    // Latest verdict with cryptographic row_hash
    const verdictRes = await query<any>(
      `SELECT id, obs_date, scoring_config_version, verdict, lifecycle,
              d_basis_points, m_basis_points, w_basis_points, confidence,
              raw_verdict, flags, explanation, features_hash, hash_version,
              prev_hash, row_hash, created_at
       FROM verdicts
       WHERE opportunity_id = $1
       ORDER BY obs_date DESC
       LIMIT 1`,
      [opp.id]
    );

    return {
      opportunity: opp,
      queries: queriesRes.rows,
      serpResults: serpRes.rows,
      evidence: evidenceRes.rows,
      commercialProof,
      killCriteria: kcRes.rows,
      latestVerdict: verdictRes.rows[0] || null,
    };
  }
}
