import { createHash, randomBytes } from 'node:crypto';
import { query, transaction } from '@emeradar/db';
import {
  AppError,
  Verdict,
  BuildArchetype,
  ExecutionClass,
  Confidence,
  Band,
} from '@emeradar/core';
import { AutocompleteCollector, CrawlCollector, SerpCollector } from '@emeradar/collectors';
import {
  collectObservationCard,
  loadObservationCard,
  type ObservationCard,
} from './observation-card.service';
import {
  evaluateScanVerdict,
  findKnownNeighbors,
  type ScanVerdictResult,
} from './scan-verdict.service';

export interface LiveScanResult {
  opportunityId: string;
  slug: string;
  title: string;
  verdict: Verdict;
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
  primaryQuery: string;
  suggestions: string[];
  isNew: boolean;
  /** CANDIDATE 只有入雷达/等晋升；详情页只对 TRACKED 开放。 */
  status: string;
  /**
   * 观测卡：扫码当天的真实事实（联想词 / SERP Top10 弱点 / 前排定价）。
   * 它**不是裁决**，也永远不会被当成裁决——裁决仍需要 14 天历史。
   */
  observation: ObservationCard;
  /**
   * 三态判断：做 / 不做 / 还不行。
   *
   * 这是扫码的**唯一主输出**。`observation` 只是它的依据之一，
   * 不再作为给用户看的信息面板存在。
   */
  verdictFit: ScanVerdictResult;
}

/** 初筛展示的长尾词上限（10 §4.3）；入库与返回共用，保证两处是同一份词表。 */
export const SCREENER_LONGTAIL_LIMIT = 15;

import { classifyQueryIntent } from './query-intent';

/**
 * 读不到任何已存观测时的占位。
 *
 * 刻意把 `available=false` 与“观测到没有竞争”区分开：前者是“不知道”，
 * 如果渲染成“Top10 干净”，就等于把采集失败说成了机会。
 */
/**
 * 给“不做 / 还不行”补上库里真实观测过的同族词。
 *
 * 优先用已有观测的词（可在库里核对），没有才保留启发式建议——并且照样标注来源。
 */
async function attachRealAlternatives(
  result: ScanVerdictResult,
  query: string
): Promise<ScanVerdictResult> {
  if (result.verdict === 'BUILD') return result;
  try {
    const known = await findKnownNeighbors(query);
    if (known.length === 0) return result;
    const real = known.slice(0, 3).map((text) => ({ query: text, why: '库里已有观测的同族词' }));
    const seen = new Set(real.map((row) => row.query));
    const merged = [...real, ...result.alternatives.filter((row) => !seen.has(row.query))].slice(0, 3);
    return { ...result, alternatives: merged };
  } catch {
    return result;
  }
}

/** 从观测卡抽出三态判断所需的信号；替代词由调用方补。 */
function verdictFromCard(card: ObservationCard, query: string): ScanVerdictResult {
  const priced = card.pricing.domains
    .filter((row) => row.plans.length > 0)
    .map((row) => {
      const prices = row.plans
        .map((plan) => plan.priceMonthly)
        .filter((price): price is number => typeof price === 'number' && Number.isFinite(price));
      return {
        domain: row.domain,
        minPrice: prices.length > 0 ? Math.min(...prices) : null,
        currency: row.plans[0]?.currency ?? '$',
      };
    });

  return evaluateScanVerdict({
    query,
    intent: card.intent,
    priced,
    probedDomains: card.pricing.probed,
    blockedDomains: card.pricing.blocked,
    competitors: card.serp.distinctDomains,
    weakDomains: card.serp.weakDomains,
    dedicatedToolPages: card.serp.dedicatedToolPages,
  });
}

function emptyObservation(query: string, market: string, language: string): ObservationCard {
  return {
    kind: 'OBSERVATION',
    observedAt: new Date().toISOString(),
    market,
    language,
    query,
    autocomplete: {
      observed: false,
      suggestions: [],
      note: 'No autocomplete observation stored yet.',
    },
    serp: {
      available: false,
      provider: null,
      depth: 0,
      items: [],
      positions: 0,
      distinctDomains: 0,
      duplicatePositions: 0,
      weakCount: 0,
      weakRatio: 0,
      weaknessScore: null,
      pageKindCounts: {},
      competitors: [],
      weakDomains: 0,
      dedicatedToolPages: 0,
      note: 'No organic SERP observation stored yet. Competition is unknown, not weak.',
    },
    intent: {
      intentFit: 'INSUFFICIENT',
      score: 0,
      signals: {
        toolModifier: false,
        informationalModifier: false,
        dedicatedToolPages: 0,
        distinctDomains: 0,
        toolPageShare: 0,
        pricedDomains: 0,
        blockedDomains: 0,
        vendorIntent: null,
      },
      reason: 'No observation yet, so intent cannot be judged.',
      ruleVersion: 'intent-fit-v1',
    },
    pricing: {
      probed: 0,
      priced: 0,
      infraOnly: 0,
      blocked: 0,
      domains: [],
      note: 'No competitor pricing observation stored yet.',
    },
    verdictEta: {
      needsAutocompleteDays: 14,
      needsSerpDays: 14,
      reason:
        'A published BUILD NOW / EARLY BET needs 14 days of autocomplete and 14 days of organic SERP history.',
    },
  };
}

export class LiveScanService {
  /**
   * Scans a target keyword using live Google Autocomplete + SERP competitive weakness analysis
   */
  static async scan(input: {
    query: string;
    userId?: string;
    marketCountry?: string;
    language?: string;
    preferredArchetype?: BuildArchetype;
  }): Promise<LiveScanResult> {
    const rawQuery = input.query.trim();
    if (!rawQuery || rawQuery.length < 2) {
      throw AppError.badRequest('Query must be at least 2 characters long.');
    }

    const marketCountry = input.marketCountry || 'US';
    const language = input.language || 'en-US';
    const obsDate = new Date().toISOString().slice(0, 10);

    // Generate normalized slug
    const baseSlug = rawQuery
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const slug = baseSlug || `query-${createHash('sha256').update(rawQuery.toLowerCase()).digest('hex').slice(0, 12)}`;

    // 1. Check if opportunity already exists
    const existing = await query<any>(
      `SELECT c.opportunity_id, c.slug, o.title, o.status, c.verdict,
              c.d_basis_points, c.m_basis_points, c.w_basis_points,
              c.d_band, c.m_band, c.w_band, c.confidence,
              c.recommended_archetype, c.execution_class,
              c.why_now_summary, c.top_idea, c.primary_query,
              o.market_country, o.research_language,
              (SELECT oq.query_id FROM opportunity_queries oq
                WHERE oq.opportunity_id = c.opportunity_id AND oq.role = 'PRIMARY'
                LIMIT 1) AS primary_query_id
       FROM opportunity_cards c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE c.slug = $1 OR LOWER(c.primary_query) = LOWER($2)
       LIMIT 1`,
      [slug, rawQuery]
    );

    if (existing.rows.length > 0) {
      const r = existing.rows[0];
      const observation = await loadObservationCard(
        r.opportunity_id,
        r.primary_query_id ?? null,
        r.primary_query,
        r.market_country,
        r.research_language
      ).catch(() => emptyObservation(r.primary_query, r.market_country, r.research_language));
      // 长尾词与报告、点火包同源：只读 opportunity_queries 里已入库的簇内词。
      const clusterWords = (
        await query<{ query_text: string }>(
          `SELECT q.query_text
             FROM opportunity_queries oq
             JOIN queries q ON q.id = oq.query_id
            WHERE oq.opportunity_id = $1 AND oq.role = 'CLUSTER'
            ORDER BY q.query_text
            LIMIT $2`,
          [r.opportunity_id, SCREENER_LONGTAIL_LIMIT]
        )
      ).rows.map((row) => row.query_text);
      return {
        opportunityId: r.opportunity_id,
        slug: r.slug,
        title: r.title,
        verdict: r.verdict,
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
        primaryQuery: r.primary_query,
        suggestions: clusterWords,
        isNew: false,
        status: r.status,
        observation,
        verdictFit: await attachRealAlternatives(
          verdictFromCard(observation, r.primary_query),
          r.primary_query
        ),
      };
    }

    // 2. First autocomplete observation。走与日常管线同一个采集器（AIsa/DataForSEO），
    //    不再自采 suggestqueries：同一个事实只应有一个来源，否则两处会给出不同的词表。
    const autocomplete = await this.fetchAutocomplete(rawQuery, marketCountry, language);
    const suggestions = autocomplete.suggestions;
    const autocompleteObserved = autocomplete.observed;
    const storedSuggestions = suggestions.slice(0, SCREENER_LONGTAIL_LIMIT);

    // 3. Auxiliary source sample. This is not an organic SERP, so it does not score W.
    // 4. Publication gate: one observation cannot publish a build verdict (01 §1.7, 05 §5.0).
    const qLower = rawQuery.toLowerCase();
    const dBasisPoints = 0;
    const mBasisPoints = 0;
    const wBasisPoints = 0;
    const dBand: Band = 'INSUFFICIENT';
    const mBand: Band = 'INSUFFICIENT';
    const wBand: Band = 'INSUFFICIENT';
    const confidence: Confidence = 'LOW';
    const verdict: Verdict = 'WATCH';

    // Recommended Archetype
    let recommendedArchetype: BuildArchetype = input.preferredArchetype || 'TOOL';
    if (!input.preferredArchetype) {
      if (qLower.includes('sync') || qLower.includes('backup') || qLower.includes('audit') || qLower.includes('monitor')) {
        recommendedArchetype = 'MICRO_SAAS';
      } else if (qLower.includes('directory') || qLower.includes('list') || qLower.includes('curated')) {
        recommendedArchetype = 'DIRECTORY';
      } else {
        recommendedArchetype = 'TOOL';
      }
    }

    const executionClass: ExecutionClass =
      recommendedArchetype === 'TOOL' ? 'S' : recommendedArchetype === 'MICRO_SAAS' ? 'M' : 'S';

    // Title & Catalysts
    const title = rawQuery;
    const whyNowSummary = `Tracking started for the US English query "${rawQuery}". A published verdict needs 14 days of autocomplete history and one single-source organic SERP snapshot. This first observation is not a build decision.`;
    const topIdea = `No build shape yet. A recommendation is assigned only after a published BUILD NOW or EARLY BET.`;

    // 6. Generate IDs
    const oppId = `opp_${slug.slice(0, 16)}_${randomBytes(3).toString('hex')}`;
    const primaryQueryId = `qry_${randomBytes(6).toString('hex')}`;

    // 7. Store in PostgreSQL Transaction。
    //    真实主 query id 在事务内解析（碰撞时沿用已存在行的 id），但要带出事务给
    //    观测卡用，所以声明在外部。
    let primaryQueryRowId = primaryQueryId;
    await transaction(async (client) => {
      // 1. Insert primary query，并**取回真实 id**。
      //
      // 这里曾经只写 `ON CONFLICT (id) DO NOTHING`，但 `queries` 上还有
      // `(query_text, market_country, research_language)` 的唯一约束：只要这个词
      // 已经作为簇内词/种子词存在（很常见——联想词扩簇、种子长尾都会写 queries），
      // 插入就会撞上文本唯一约束，整个扫描 500。冲突目标必须与真实约束一致，
      // 并且后续关联要用返回的 id，而不是我们编出来的那个。
      const insertedQuery = await client.query<{ id: string }>(
        `INSERT INTO queries (id, query_text, market_country, research_language, tier)
         VALUES ($1, $2, $3, $4, 'A')
         ON CONFLICT (query_text, market_country, research_language)
         DO UPDATE SET tier = LEAST(queries.tier, 'A')
         RETURNING id`,
        [primaryQueryId, rawQuery, marketCountry, language]
      );
      primaryQueryRowId = insertedQuery.rows[0]?.id ?? primaryQueryId;

      // 2. Insert opportunity
      await client.query(
        `INSERT INTO opportunities (
          id, slug, title, status, market_country, research_language,
          recommended_archetype, execution_class, discovery_source
         ) VALUES ($1, $2, $3, 'CANDIDATE', $4, $5, $6, $7, 'LIVE_SCAN')`,
        [oppId, slug, title, marketCountry, language, recommendedArchetype, executionClass]
      );

      // 3. Link opportunity query（用真实 id，不是生成的 id）
      await client.query(
        `INSERT INTO opportunity_queries (opportunity_id, query_id, role)
         VALUES ($1, $2, 'PRIMARY')
         ON CONFLICT (opportunity_id, query_id) DO NOTHING`,
        [oppId, primaryQueryRowId]
      );

      // 4. Insert cluster queries from autocomplete
      for (const sug of storedSuggestions) {
        const clusterQueryId = `qry_${randomBytes(6).toString('hex')}`;
        await client.query(
          `INSERT INTO queries (id, query_text, market_country, research_language, tier, intent)
           VALUES ($1, $2, $3, $4, 'B', $5)
           ON CONFLICT (query_text, market_country, research_language)
           DO UPDATE SET tier = LEAST(queries.tier, EXCLUDED.tier)
           RETURNING id`,
          [clusterQueryId, sug, marketCountry, language, classifyQueryIntent(sug)]
        );
        const existingQuery = await client.query<{ id: string }>(
          `SELECT id FROM queries WHERE query_text = $1 AND market_country = $2 AND research_language = $3`,
          [sug, marketCountry, language]
        );
        await client.query(
          `INSERT INTO opportunity_queries (opportunity_id, query_id, role)
           VALUES ($1, $2, 'CLUSTER') ON CONFLICT DO NOTHING`,
          [oppId, existingQuery.rows[0].id]
        );
      }

      // 5. Opportunity Snapshot
      const snapshotId = `snp_${oppId}_today`;
      await client.query(
        `INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date, metrics)
         VALUES ($1, $2, CURRENT_DATE, $3)`,
        [
          snapshotId,
          oppId,
          JSON.stringify({
            d_score: dBasisPoints,
            m_score: mBasisPoints,
            w_score: wBasisPoints,
            weak_count: 0,
          }),
        ]
      );

      // 6. Materialized Card
      await client.query(
        `INSERT INTO opportunity_cards (
          opportunity_id, slug, primary_query, verdict, lifecycle,
          d_basis_points, m_basis_points, w_basis_points,
          d_band, m_band, w_band, confidence,
          recommended_archetype, execution_class, why_now_summary, top_idea,
          first_observed_at, query_velocity, featured_evidence_snippet
         ) VALUES (
          $1, $2, $3, $4, 'FORMING',
          $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14, $15,
          NOW(), 0, $16
         )`,
        [
          oppId,
          slug,
          rawQuery,
          verdict,
          dBasisPoints,
          mBasisPoints,
          wBasisPoints,
          dBand,
          mBand,
          wBand,
          confidence,
          recommendedArchetype,
          executionClass,
          whyNowSummary,
          topIdea,
          autocompleteObserved
            ? `First autocomplete observation returned ${suggestions.length} suggestions. Demand is not scored until 14 days of history exist.`
            : `Autocomplete was unavailable. No suggestions were stored.`,
        ]
      );

      if (autocompleteObserved && suggestions.length > 0) {
        await client.query(
          `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions, depth)
           VALUES ($1, CURRENT_DATE, $2, 1)
           ON CONFLICT (query_id, observed_date) DO UPDATE SET
             suggestions = EXCLUDED.suggestions,
             depth = EXCLUDED.depth`,
          [primaryQueryRowId, suggestions]
        );
      }

      // 8. Evidence record
      await client.query(
        `INSERT INTO evidence (opportunity_id, evidence_class, source_type, domain, title, snippet, payload)
         VALUES ($1, $2, 'AUTOCOMPLETE', 'google.com', $3, $4, $5)`,
        [
          oppId,
          autocompleteObserved ? 'OBSERVED' : 'INFERRED',
          autocompleteObserved
            ? `Autocomplete suggestions for "${rawQuery}"`
            : `Autocomplete unavailable for "${rawQuery}"`,
          autocompleteObserved
            ? suggestions.slice(0, 4).join(', ')
            : 'No suggestions stored. A failed suggest fetch is not demand.',
          JSON.stringify({ suggestions, totalFound: suggestions.length, observed: autocompleteObserved }),
        ]
      );

    });

    // 观测卡：把“现在就看得见的事实”立刻交给用户。裁决仍然要等 14 天，
    // 但用户不必为了看到竞品长什么样而等 14 天。
    const observation = await collectObservationCard(
      {
        opportunityId: oppId,
        queryId: primaryQueryRowId,
        query: rawQuery,
        marketCountry,
        language,
        obsDate,
      },
      {
        serp: new SerpCollector(),
        crawl: new CrawlCollector(),
        autocompleteObserved,
        suggestions: storedSuggestions,
      }
    ).catch((error) => {
      console.warn(
        `[live-scan] observation collection failed for "${rawQuery}":`,
        error instanceof Error ? error.message : error
      );
      return emptyObservation(rawQuery, marketCountry, language);
    });

    return {
      opportunityId: oppId,
      slug,
      title,
      verdict,
      dBasisPoints,
      mBasisPoints,
      wBasisPoints,
      dBand,
      mBand,
      wBand,
      confidence,
      recommendedArchetype,
      executionClass,
      whyNowSummary,
      topIdea,
      primaryQuery: rawQuery,
      suggestions: storedSuggestions,
      isNew: true,
      status: 'CANDIDATE',
      observation,
      verdictFit: await attachRealAlternatives(verdictFromCard(observation, rawQuery), rawQuery),
    };
  }

  /**
   * 真实联想词。走 `AutocompleteCollector`（AIsa → DataForSEO），与每日管线同源。
   *
   * 采集失败时返回 `observed: false` 且**不存任何词**——一次失败的抓取不是“没有需求”，
   * 把空数组当成需求为零是最容易犯、也最难发现的错。
   */
  private static async fetchAutocomplete(
    query: string,
    marketCountry: string,
    language: string
  ): Promise<{ suggestions: string[]; observed: boolean }> {
    try {
      const obsDate = new Date().toISOString().slice(0, 10);
      const collector = new AutocompleteCollector();
      const ctx = {
        runId: `scan_ac_${Date.now()}`,
        obsDate,
        clock: () => new Date(),
        budget: { maxDailyBudgetUsd: 20, currentSpentUsd: 0, canSpend: () => true },
      };
      const outcome = await collector.collect(ctx as any, {
        queryId: `qry_scan_${Date.now()}`,
        queryText: query,
        marketCountry,
        language,
      });
      if (outcome.status !== 'OK') return { suggestions: [], observed: false };
      const suggestions = (outcome.snapshots[0]?.data?.suggestions ?? []) as string[];
      if (suggestions.length === 0) return { suggestions: [], observed: false };
      return {
        suggestions: suggestions.filter((s) => s.toLowerCase() !== query.toLowerCase()),
        observed: true,
      };
    } catch {
      return { suggestions: [], observed: false };
    }
  }
}
