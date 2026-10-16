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
import { stealthHiddenPredicate, maskedLabel, maskedSlug, PUBLICATION_LOCALES } from './stealth-lock-policy';

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
  /** 该查询已入库且正处于买断保护期（15 §3.1）。为真时上面几个文本字段是打码值。 */
  isStealthLocked: boolean;
}

/** 初筛展示的长尾词上限（10 §4.3）；入库与返回共用，保证两处是同一份词表。 */
export const SCREENER_LONGTAIL_LIMIT = 15;

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

    // Generate normalized slug
    const baseSlug = rawQuery
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const slug = baseSlug || `query-${createHash('sha256').update(rawQuery.toLowerCase()).digest('hex').slice(0, 12)}`;

    // 1. Check if opportunity already exists
    //
    // 保护期内的那一条**照常命中**，但下游会把它整个打码。这里不能改用
    // `hiddenFromEveryone` 把它过滤掉：命中不到就会走下面的建号分支，于是同一个
    // 查询会多出一条新的 CANDIDATE。那条新机会不受买断约束，几天后可能自己长成
    // 一条 TRACKED 机会——**一次独占买断被一条重复记录彻底作废**，而且没有任何
    // 一处会报错。宁可让这条已知的查询返回一个打码结果。
    const existing = await query<any>(
      `SELECT c.opportunity_id, c.slug, o.title, c.verdict,
              c.d_basis_points, c.m_basis_points, c.w_basis_points,
              c.d_band, c.m_band, c.w_band, c.confidence,
              c.recommended_archetype, c.execution_class,
              c.why_now_summary, c.top_idea, c.primary_query,
              sl.id AS stealth_lock_id, d.masked_label
       FROM opportunity_cards c
       JOIN opportunities o ON o.id = c.opportunity_id
       LEFT JOIN stealth_locks sl
              ON sl.opportunity_id = o.id AND ${stealthHiddenPredicate('sl')}
       LEFT JOIN stealth_lock_displays d
              ON d.stealth_lock_id = sl.id AND d.locale = $3
       WHERE c.slug = $1 OR LOWER(c.primary_query) = LOWER($2)
       LIMIT 1`,
      [slug, rawQuery, PUBLICATION_LOCALES[0]]
    );

    if (existing.rows.length > 0) {
      const r = existing.rows[0];
      /**
       * 打码后仍然照常返回的：判定与三轴档位、置信度、执行分类（15 §3.1 第 1 条
       * 「其余结构化信息照常」；这些是"这条机会怎么样"，不是"这条机会是什么"）。
       * 被替换掉的只有能反推出词根的那几个文本字段。
       *
       * 残留披露：这确实告诉调用者"这个查询在库里、并且正被买断"。这是刻意接受的
       * ——查询文本是他自己敲进来的，他没有从中学到新词；而相比"静默建一条重复机会"
       * 那条路，这点披露便宜得多。
       */
      // 长尾词与报告、点火包同源：只读 opportunity_queries 里已入库的簇内词。
      // 打码中的机会不返回，否则能从词表反推词根。
      const clusterWords = r.stealth_lock_id
        ? []
        : (
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
      const mask = r.stealth_lock_id
        ? {
            label: r.masked_label ?? maskedLabel(r.stealth_lock_id),
            slug: maskedSlug(r.stealth_lock_id),
          }
        : null;
      return {
        opportunityId: r.opportunity_id,
        slug: mask ? mask.slug : r.slug,
        title: mask ? mask.label : r.title,
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
        whyNowSummary: mask ? mask.label : r.why_now_summary,
        topIdea: mask ? mask.label : r.top_idea,
        primaryQuery: mask ? mask.label : r.primary_query,
        suggestions: clusterWords,
        isNew: false,
        isStealthLocked: Boolean(mask),
      };
    }

    // 2. First autocomplete observation. A miss stores nothing rather than a canned cluster.
    const autocomplete = await this.fetchGoogleAutocomplete(rawQuery);
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

    // 7. Store in PostgreSQL Transaction
    await transaction(async (client) => {
      // 1. Insert primary query
      await client.query(
        `INSERT INTO queries (id, query_text, market_country, research_language, tier)
         VALUES ($1, $2, $3, $4, 'A')
         ON CONFLICT (id) DO NOTHING`,
        [primaryQueryId, rawQuery, marketCountry, language]
      );

      // 2. Insert opportunity
      await client.query(
        `INSERT INTO opportunities (
          id, slug, title, status, market_country, research_language,
          recommended_archetype, execution_class
         ) VALUES ($1, $2, $3, 'CANDIDATE', $4, $5, $6, $7)`,
        [oppId, slug, title, marketCountry, language, recommendedArchetype, executionClass]
      );

      // 3. Link opportunity query
      await client.query(
        `INSERT INTO opportunity_queries (opportunity_id, query_id, role)
         VALUES ($1, $2, 'PRIMARY')`,
        [oppId, primaryQueryId]
      );

      // 4. Insert cluster queries from autocomplete
      for (const sug of storedSuggestions) {
        const clusterQueryId = `qry_${randomBytes(6).toString('hex')}`;
        await client.query(
          `INSERT INTO queries (id, query_text, market_country, research_language, tier)
           VALUES ($1, $2, $3, $4, 'B')
           ON CONFLICT (query_text, market_country, research_language)
           DO UPDATE SET tier = LEAST(queries.tier, EXCLUDED.tier)
           RETURNING id`,
          [clusterQueryId, sug, marketCountry, language]
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
          [primaryQueryId, suggestions]
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
      isStealthLocked: false,
    };
  }

  /**
   * Fetches real suggestions from Google Autocomplete API
   */
  private static async fetchGoogleAutocomplete(
    query: string
  ): Promise<{ suggestions: string[]; observed: boolean }> {
    try {
      const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(
        query
      )}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(3500),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && Array.isArray(data[1]) && data[1].length > 0) {
          return {
            observed: true,
            suggestions: data[1]
              .map((s: any) => String(s))
              .filter((s: string) => s.toLowerCase() !== query.toLowerCase()),
          };
        }
      }
    } catch {
      // Unavailable. Do not invent suggestions.
    }

    return { suggestions: [], observed: false };
  }
}
