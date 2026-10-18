import { query, transaction } from '@emeradar/db';
import {
  AxisBand,
  bandM,
  buildPrevScoringState,
  calculateOpportunityScore,
  CommercialSummary,
  DatedWBand,
  FullOpportunityScoreInput,
} from '@emeradar/scoring';
import { Lifecycle, Verdict } from '@emeradar/core';
import { RankingService } from '../ranking.service';
import {
  AutocompleteCollector,
  CostLedgerService,
  CrawlCollector,
  RunContext,
  SerpCollector,
  SerpRankIndexEntry,
} from '@emeradar/collectors';
import {
  FetchFailureFacts,
  buildCommercialRawSummary,
  emitNegativesFromDiff,
  factsFromCrawl,
  hasFreshCommercialSnapshot,
  writeCommercialSnapshot,
  writeFailedCommercialSnapshot,
} from './commercial-assembly';
import { computeCrowding, storeCrowding } from '../crowding.service';
import { runCollector } from '../collector-run.service';
import { storeRawPayload } from '../raw-payload.service';

const SKIP_COMMERCIAL_DOMAINS = [
  'github.com',
  'stackoverflow.com',
  'stackexchange.com',
  'wikipedia.org',
  'news.ycombinator.com',
  'reddit.com',
  'youtube.com',
  'medium.com',
  'quora.com',
];

// 07 §7 samples weekly, so a wider target set costs less than it looks: a domain with a
// successful read is not re-fetched for COMMERCIAL_STALENESS_DAYS.
const COMMERCIAL_MAX_TARGETS_PER_OPP = 8;
const COMMERCIAL_STALENESS_DAYS = 7;

export interface ObservedOpportunity {
  opportunityId: string;
  slug: string;
  title: string;
  primaryQuery: string;
  output: ReturnType<typeof calculateOpportunityScore>;
  velocity: number;
  whyNowSummary: string;
  topIdea: string;
  publishable: boolean;
  previousVerdict: string | null;
  /** 封存的特征快照，账本以其 JCS 指纹写入 features_hash（06 §3）。 */
  featureMetrics: Record<string, unknown>;
  /** 今日 SERP 弱点占比；今日没有成功的 SERP 观测时为 null。 */
  weakResultRatio: number | null;
}

export async function observeOpportunity(
  opp: {
    id: string;
    slug: string;
    title: string;
    market_country: string;
    research_language: string;
    recommended_archetype: string;
    execution_class: string;
  },
  obsDate: string,
  ctx: RunContext,
  collectors: {
    autocomplete: AutocompleteCollector;
    serp: SerpCollector;
    crawl: CrawlCollector;
  }
): Promise<ObservedOpportunity | null> {
  const qryRes = await query<{ id: string; query_text: string; tier: 'A' | 'B' | 'C' }>(
    `SELECT q.id, q.query_text, q.tier FROM opportunity_queries oq
     JOIN queries q ON q.id = oq.query_id
     WHERE oq.opportunity_id = $1 AND oq.role = 'PRIMARY'`,
    [opp.id]
  );
  const primary = qryRes.rows[0];
  if (!primary) return null;

  const acOutcome = await runCollector('src_ac', primary.id, () =>
    collectors.autocomplete.collect(ctx, {
      queryId: primary.id,
      queryText: primary.query_text,
      opportunityId: opp.id,
      marketCountry: opp.market_country,
      language: opp.research_language,
    })
  );

  // Spend is recorded for every billable outcome, not only successes: a 429 or a
  // timeout still costs the provider call.
  if (acOutcome.status !== 'SKIPPED' && acOutcome.cost) {
    await CostLedgerService.recordCost(acOutcome.cost);
  }

  if (acOutcome.status === 'OK') {
    const snap = acOutcome.snapshots[0];
    if (snap) {
      await query(
        `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions, depth, provider)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (query_id, observed_date) DO UPDATE SET
           suggestions = EXCLUDED.suggestions,
           depth = EXCLUDED.depth,
           provider = EXCLUDED.provider`,
        [primary.id, obsDate, snap.data.suggestions, snap.data.depth, snap.data.provider ?? 'UNKNOWN']
      );
    }
  }

  const autocompleteHistoryRes = await query<{ days: number }>(
    `SELECT COUNT(DISTINCT observed_date)::int AS days
     FROM autocomplete_observations
     WHERE query_id = $1 AND observed_date <= $2`,
    [primary.id, obsDate]
  );
  const historyDays = autocompleteHistoryRes.rows[0]?.days ?? 0;

  const freshRes = await query<{ count: number }>(
    `SELECT COUNT(DISTINCT s)::int AS count
     FROM (
       SELECT unnest(suggestions) AS s
       FROM autocomplete_observations
       WHERE query_id = $1 AND observed_date <= $2::date AND observed_date > $2::date - 7
       EXCEPT
       SELECT unnest(suggestions)
       FROM autocomplete_observations
       WHERE query_id = $1 AND observed_date <= $2::date - 7
     ) fresh`,
    [primary.id, obsDate]
  );
  const newQueries7d = freshRes.rows[0]?.count ?? 0;

  const trendRes = await query<{ recent_days: number; prior_days: number; recent_avg: number; prior_avg: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE observed_date > $2::date - 7 AND observed_date <= $2::date)::int AS recent_days,
       COUNT(*) FILTER (WHERE observed_date > $2::date - 14 AND observed_date <= $2::date - 7)::int AS prior_days,
       COALESCE(AVG(cardinality(suggestions)) FILTER (WHERE observed_date > $2::date - 7 AND observed_date <= $2::date), 0)::float AS recent_avg,
       COALESCE(AVG(cardinality(suggestions)) FILTER (WHERE observed_date > $2::date - 14 AND observed_date <= $2::date - 7), 0)::float AS prior_avg
     FROM autocomplete_observations
     WHERE query_id = $1 AND observed_date > $2::date - 14 AND observed_date <= $2::date`,
    [primary.id, obsDate]
  );
  // Decay signal for the lifecycle DEAD transition (05 §4): trailing 7-day
  // observation volume against the strongest 7-day window inside 90 days.
  const decayRes = await query<{ active_7d: number; peak_7d: number }>(
    `WITH daily AS (
       SELECT observed_date, SUM(cardinality(suggestions))::float AS total
       FROM autocomplete_observations
       WHERE query_id = $1 AND observed_date > $2::date - 90 AND observed_date <= $2::date
       GROUP BY observed_date
     )
     SELECT
       (SELECT COALESCE(SUM(total), 0) FROM daily WHERE observed_date > $2::date - 7)::float AS active_7d,
       (SELECT COALESCE(MAX(window_total), 0) FROM (
          SELECT (SELECT COALESCE(SUM(d2.total), 0) FROM daily d2
                   WHERE d2.observed_date > d1.observed_date - 7
                     AND d2.observed_date <= d1.observed_date) AS window_total
          FROM daily d1
        ) windows)::float AS peak_7d`,
    [primary.id, obsDate]
  );
  const active7d = decayRes.rows[0]?.active_7d ?? 0;
  const peak7d = decayRes.rows[0]?.peak_7d ?? 0;
  const activityRatio90d = peak7d > 0 ? active7d / peak7d : undefined;

  const trend = trendRes.rows[0];
  const autocompleteRecentDays = trend?.recent_days ?? 0;
  const autocompletePriorDays = trend?.prior_days ?? 0;
  const autocompleteCoverage = Math.min(1, autocompleteRecentDays / 7);
  const autocompleteGrowth = trend?.prior_avg && trend.prior_avg > 0
    ? (trend.recent_avg - trend.prior_avg) / trend.prior_avg
    : null;

  // 深度分层（ADR-022、04 §9.2）：默认 Top 10；只有映射到已核验 Project 的 query，
  // 且当周还没取过 Top 100 时才取 100。11–100 名唯一的消费者就是项目排名追踪。
  const trackedRes = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM project_credentials pc
       JOIN projects p ON p.id = pc.project_id
      WHERE p.opportunity_id = $1
        AND p.status <> 'ARCHIVED'
        AND pc.verification_state = 'VERIFIED'
        AND pc.host IS NOT NULL`,
    [opp.id]
  );
  const weeklyDepthRes = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM serp_snapshots
      WHERE query_id = $1 AND depth >= 100
        AND obs_date > $2::date - 7 AND obs_date < $2::date`,
    [primary.id, obsDate]
  );
  const wantsDeepSerp = (trackedRes.rows[0]?.n ?? 0) > 0 && (weeklyDepthRes.rows[0]?.n ?? 0) === 0;
  const serpDepth = wantsDeepSerp ? 100 : undefined;

  const serpOutcome = await runCollector('src_serp', primary.id, async () => {
    const collectOnce = () =>
      collectors.serp.collect(ctx, {
        queryId: primary.id,
        queryText: primary.query_text,
        opportunityId: opp.id,
        marketCountry: opp.market_country,
        researchLanguage: opp.research_language,
        depth: serpDepth,
      });

    let outcome = await collectOnce();
    // A billable provider call costs money whether or not it returned data.
    if (outcome.status !== 'SKIPPED' && outcome.cost) {
      await CostLedgerService.recordCost(outcome.cost);
    }
    if (outcome.status === 'FAILED' && outcome.retryable) {
      console.warn(
        `[pipeline:collector] Retrying SERP collection for query "${primary.query_text}" (${outcome.message})...`
      );
      await new Promise((r) => setTimeout(r, 1000));
      outcome = await collectOnce();
      if (outcome.status !== 'SKIPPED' && outcome.cost) {
        await CostLedgerService.recordCost(outcome.cost);
      }
    }
    return outcome;
  });

  // 原始响应归档（R2）。失败不阻断观测：账本仍可用归一化行计算，只是失去回放能力。
  let serpRawPayloadId: string | null = null;
  const serpRunId = (serpOutcome as { collectorRunId?: string }).collectorRunId;
  if (serpOutcome.status === 'OK' && serpOutcome.raw && serpRunId) {
    try {
      const stored = await storeRawPayload({
        collectorRunId: serpRunId,
        obsDate,
        content: serpOutcome.raw.content,
        mimeType: serpOutcome.raw.mimeType,
      });
      serpRawPayloadId = stored?.id ?? null;
    } catch (error) {
      console.warn(
        `[pipeline:collector] raw payload archive failed for query "${primary.query_text}":`,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (serpOutcome.status !== 'OK') {
    const outcomeDetails = 'message' in serpOutcome ? (serpOutcome as any).message : (serpOutcome as any).reason;
    console.warn(
      `[pipeline:collector] SERP collection failed for query "${primary.query_text}": status=${serpOutcome.status}, reason=${outcomeDetails}`
    );
  }

  let serpWeakness = 0;
  // 今日 SERP 弱点占比，只供 Kill Criteria 求值；不进 featureMetrics，免得改动账本指纹。
  let weakResultRatio: number | null = null;
  // `organicItems` 是**评分集**（rank 1–10）：它决定 `serp_results` 的内容与商业域抓取
  // 的目标。`rankIndex` 是同一次请求拿回的全部名次（rank 1–100），只用于在内存里比对
  // 已核验项目是否入榜（PRD F10）。
  //
  // 两者必须分开。合成一个的话，要么 `serp_results` 会塞进 rank 11–100 —— 撞上
  // `rank BETWEEN 1 AND 20` 的 CHECK —— 要么商业域抓取会从 10 个域名涨到 100 个，
  // 让单条机会的抓取成本变成十倍。
  let organicItems: Array<{ domain: string; url: string }> = [];
  let rankIndex: SerpRankIndexEntry[] = [];
  if (serpOutcome.status === 'OK') {
    const serpSnap = serpOutcome.snapshots[0];
    if (serpSnap) {
      serpWeakness = serpSnap.data.weaknessScore;
      weakResultRatio = serpSnap.data.weakResultRatio;
      organicItems = serpSnap.data.items || [];
      rankIndex = serpSnap.data.rankIndex;
      const snapRes = await query<{ id: string }>(
        `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio, depth, result_count, provider, raw_payload_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (query_id, obs_date) DO UPDATE SET
           weak_result_ratio = EXCLUDED.weak_result_ratio,
           depth = EXCLUDED.depth,
           result_count = EXCLUDED.result_count,
           provider = EXCLUDED.provider,
           raw_payload_id = COALESCE(EXCLUDED.raw_payload_id, serp_snapshots.raw_payload_id)
         RETURNING id`,
        [
          serpSnap.key,
          primary.id,
          obsDate,
          serpSnap.data.weakResultRatio,
          // 深度与条数一并落库（02 §5）。`result_count` 是解释 `best_rank IS NULL` 的
          // 那一半：没有它，"这个项目连续 60 天没进榜"与"我们那 60 天只采了 10 条"
          // 在库里是同一句话。这里不做兜底取值——采集侧必给，缺了就该当场报错，
          // 而不是把谎话写进一列专门用来防谎话的字段。
          serpSnap.data.depth,
          serpSnap.data.resultCount,
          serpSnap.data.provider ?? 'UNKNOWN',
          serpRawPayloadId,
        ]
      );
      const snapshotId = snapRes.rows[0]?.id || serpSnap.key;
      // DELETE + bulk INSERT must be atomic: a partial failure would otherwise
      // leave serp_results incomplete and corrupt downstream scoring.
      await transaction(async (client) => {
        await client.query(`DELETE FROM serp_results WHERE serp_snapshot_id = $1`, [snapshotId]);
        for (const item of organicItems as any[]) {
          await client.query(
            `INSERT INTO serp_results (
              serp_snapshot_id, rank, url, domain, title, snippet,
              result_type, domain_authority_class, is_weak, weakness_type
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              snapshotId,
              item.rank,
              item.url,
              item.domain,
              item.title,
              item.snippet,
              item.resultType,
              item.domainAuthorityClass,
              item.isWeak,
              item.weaknessType || null,
            ]
          );
        }
      });

      // 无感排名追踪（PRD F10、04 §9.2 一鱼多吃）：拿刚取回的名次索引比对已核验项目的
      // 主机名。**不额外发请求**——这是这条管线唯一一次 SERP 调用，追踪搭它的车。
      // 用主词（PRIMARY）那条查询记录排名：F10 的判据问的是"这个项目在主词上入榜了吗"，
      // 而簇内词的名次各自的量级不同，混在一条曲线里没有意义。
      // 只有取过 Top 100 的那天才记录：Top 10 的快照里"没看到"不等于"未入榜"。
      if (serpSnap.data.depth >= 100) {
        await RankingService.recordFromSerp({
          opportunityId: opp.id,
          queryId: primary.id,
          obsDate,
          rankIndex,
        });
      }
    }
  }

  const serpHistoryRes = await query<{ days: number; recent: boolean; days_since_last: number | null }>(
    `SELECT COUNT(DISTINCT obs_date)::int AS days,
            BOOL_OR(obs_date = $2::date) AS recent,
            ($2::date - MAX(obs_date))::int AS days_since_last
     FROM serp_snapshots
     WHERE query_id = $1 AND obs_date <= $2::date`,
    [primary.id, obsDate]
  );
  const serpHistoryDays = serpHistoryRes.rows[0]?.days ?? 0;
  const recentSerp = Boolean(serpHistoryRes.rows[0]?.recent);
  // 05 §4.2：新鲜度按追踪层级判（A 3 天 / B 8 天），不再要求"当天"有快照。
  const daysSinceLastSerp = serpHistoryRes.rows[0]?.days_since_last ?? undefined;
  const serpTier = primary.tier;

  await crawlCommercialDomains(
    organicItems,
    opp.id,
    obsDate,
    ctx,
    collectors.crawl
  );

  const commercialFacts = await buildCommercialRawSummary(
    opp.id,
    obsDate,
    opp.research_language
  );
  const commercialBanding = bandM(commercialFacts);
  const commercial: CommercialSummary = {
    ...commercialFacts,
    band: commercialBanding.band,
    totalScore: commercialBanding.basisPoints,
    stage: commercialBanding.stage,
    pricingDecorationOnly: commercialBanding.pricingDecorationOnly,
    hasStrongNegative: commercialBanding.hasStrongNegative,
    negativeReasons: commercialBanding.negativeReasons,
    persistenceDaysNeeded: commercialBanding.persistenceDaysNeeded,
    inferredOnly: commercialBanding.inferredOnly,
    bandReason: commercialBanding.reason,
  };
  const independentPricedDomains = commercial.independentPricedDomains ?? 0;
  const clusterRes = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM opportunity_queries WHERE opportunity_id = $1`,
    [opp.id]
  );

  const clusterGrowthRes = await query<{ current_count: number; prior_count: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE q.first_seen_date <= $2::date)::int AS current_count,
       COUNT(*) FILTER (WHERE q.first_seen_date <= ($2::date - 30))::int AS prior_count
     FROM opportunity_queries oq
     JOIN queries q ON q.id = oq.query_id
     WHERE oq.opportunity_id = $1`,
    [opp.id, obsDate]
  );
  const currentClusterCount = clusterGrowthRes.rows[0]?.current_count ?? clusterRes.rows[0]?.count ?? 1;
  const priorClusterCount = clusterGrowthRes.rows[0]?.prior_count ?? 0;
  const clusterGrowth30d = priorClusterCount > 0
    ? (currentClusterCount - priorClusterCount) / priorClusterCount
    : 0;

  const expansionRes = await query<{ recent_avg: number; prior_avg: number }>(
    `SELECT
       COALESCE(AVG(cardinality(suggestions)) FILTER (
         WHERE observed_date > $2::date - 7 AND observed_date <= $2::date
       ), 0)::float AS recent_avg,
       COALESCE(AVG(cardinality(suggestions)) FILTER (
         WHERE observed_date > $2::date - 14 AND observed_date <= $2::date - 7
       ), 0)::float AS prior_avg
     FROM autocomplete_observations
     WHERE query_id = $1 AND observed_date > $2::date - 14 AND observed_date <= $2::date`,
    [primary.id, obsDate]
  );
  const recentExpansion = expansionRes.rows[0]?.recent_avg ?? 0;
  const priorExpansion = expansionRes.rows[0]?.prior_avg ?? 0;
  const expansionSlope30d = priorExpansion > 0
    ? (recentExpansion - priorExpansion) / 7
    : 0;

  const attentionRes = await query<{ active_sources: number; growth: number }>(
    `SELECT
       COUNT(DISTINCT source_type) FILTER (
         WHERE observed_at >= $2::date - 14 AND observed_at < $2::date + 1
       )::int AS active_sources,
       COUNT(*) FILTER (
         WHERE observed_at >= $2::date - 14 AND observed_at < $2::date + 1
       )::int - COUNT(*) FILTER (
         WHERE observed_at >= $2::date - 28 AND observed_at < $2::date - 14
       )::int AS growth
     FROM evidence
     WHERE opportunity_id = $1`,
    [opp.id, obsDate]
  );
  const attentionSourcesActive14d = Math.min(4, attentionRes.rows[0]?.active_sources ?? 0);
  const attentionGrowth14d = attentionRes.rows[0]?.growth ?? 0;

  const windowRes = await query<{
    specialist_days: number;
    authoritative_days: number;
    volatility: number;
  }>(
    `WITH recent AS (
       SELECT s.id, s.weak_result_ratio,
              COUNT(*) FILTER (WHERE r.result_type = 'SPECIALIST')::float AS specialist_count,
              COUNT(*) FILTER (WHERE r.result_type IN ('OFFICIAL', 'DOC'))::float AS authoritative_count
       FROM serp_snapshots s
       LEFT JOIN serp_results r ON r.serp_snapshot_id = s.id AND r.rank <= 10
       WHERE s.query_id = $1 AND s.obs_date > $2::date - 30 AND s.obs_date <= $2::date
       GROUP BY s.id, s.weak_result_ratio
     )
     SELECT
       COUNT(*) FILTER (WHERE specialist_count > 0)::int AS specialist_days,
       COUNT(*) FILTER (WHERE authoritative_count > 0)::int AS authoritative_days,
       COALESCE(stddev_pop(weak_result_ratio) * 100, 0)::float AS volatility
     FROM recent`,
    [primary.id, obsDate]
  );
  const windowFeatures = windowRes.rows[0];

  const evidenceAgeRes = await query<{ median_age_days: number | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (
       ORDER BY GREATEST(0, $2::date - observed_at::date)
     )::float AS median_age_days
     FROM evidence
     WHERE opportunity_id = $1 AND observed_at::date <= $2::date`,
    [opp.id, obsDate]
  );
  const medianEvidenceAgeDays = evidenceAgeRes.rows[0]?.median_age_days ?? 0;
  const topOrganicItems = organicItems as Array<{ rank?: number; resultType?: string }>;
  const specialistToolCountInSerp = topOrganicItems.filter(
    (item) => (item.rank ?? 99) <= 10 && item.resultType === 'SPECIALIST'
  ).length;
  const authoritativeInTop3 = topOrganicItems.some(
    (item) => (item.rank ?? 99) <= 3 && ['OFFICIAL', 'DOC'].includes(item.resultType || '')
  );

  const queryRows = await query<{ query_text: string }>(
    `SELECT q.query_text
     FROM opportunity_queries oq JOIN queries q ON q.id = oq.query_id
     WHERE oq.opportunity_id = $1`,
    [opp.id]
  );
  const queryTexts = queryRows.rows.map((row) => row.query_text.toLowerCase());
  const queryCount = Math.max(1, queryTexts.length);
  const informational = queryTexts.filter((q) => /^(how|what|why|when|guide|tutorial|learn|meaning|vs\b)/.test(q)).length;
  const transactional = queryTexts.filter((q) => /\b(buy|price|pricing|cost|download|subscribe|deal|coupon)\b/.test(q)).length;
  const toolModifier = queryTexts.filter((q) => /\b(tool|calculator|generator|template|software|app)\b/.test(q)).length;
  const commercialRatio = Math.min(1, transactional / queryCount);
  const informationalRatio = Math.min(1, informational / queryCount);
  const transactionalRatio = commercialRatio;
  const toolModifierRatio = Math.min(1, toolModifier / queryCount);

  // 只取去抖真正需要的字段。这里原先是 JOIN opportunity_cards 取 w_band，
  // 但那个值从未被使用（窗口历史一律走下面的 historyRes），JOIN 纯属多余。
  const prevRes = await query<{
    verdict: string;
    raw_verdict: string | null;
    lifecycle: string;
  }>(
    `SELECT v.verdict, v.raw_verdict, v.lifecycle
     FROM verdicts v
     WHERE v.opportunity_id = $1 AND v.obs_date < $2
     ORDER BY v.obs_date DESC LIMIT 1`,
    [opp.id, obsDate]
  );
  const prev = prevRes.rows[0];

  const independentSourceCount = (acOutcome.status === 'OK' ? 1 : 0) +
    (recentSerp ? 1 : 0) + (independentPricedDomains > 0 ? 1 : 0) + (attentionSourcesActive14d > 1 ? 1 : 0);

  // 逐日档位取自账本自身，不再 JOIN opportunity_cards：后者是"当前"快照，
  // 每个历史行都会 JOIN 到同一个值，w_band 序列因此是一条水平线，
  // "窗口正在收窄"永远检测不出来。v1 行为 NULL，由下面的 filter 剔除。
  //
  // obs_date 用 to_char 取成字符串：驱动没有自定义类型解析器，DATE 会被解析成
  // **本地时区午夜**的 Date 对象，在 UTC+08:00 这类时区下再 toISOString() 会整体
  // 退一天——而"14 天内"的判据正是建立在这个日期上。
  const historyRes = await query<{
    verdict: string;
    lifecycle: string;
    w_band: string | null;
    obs_date: string;
  }>(
    `SELECT v.verdict, v.lifecycle, v.w_band, to_char(v.obs_date, 'YYYY-MM-DD') AS obs_date
     FROM verdicts v
     WHERE v.opportunity_id = $1 AND v.obs_date < $2
     ORDER BY v.obs_date DESC LIMIT 30`,
    [opp.id, obsDate]
  );

  const historyRows = historyRes.rows;

  // 相同取值的前缀长度即"已持续天数"。rows[0] 就是 prev 本身，所以从 0 数到
  // 第一个不同值即可 —— 旧实现写的是 `findIndex(...) + 1`，对 rows[0] 也加了
  // 一天，使该值恒 >= 2，去抖的"连续两天"确认实际上退化成"昨天出现过即可"。
  const streakLength = (pick: (row: (typeof historyRows)[number]) => string): number => {
    if (historyRows.length === 0) return 0;
    const head = pick(historyRows[0]);
    const idx = historyRows.findIndex((row) => pick(row) !== head);
    return idx < 0 ? historyRows.length : idx;
  };

  const daysInCurrentVerdict = prev ? streakLength((row) => row.verdict) : 0;
  // lifecycle 有它自己的 60 天判据（lifecycle.ts §6），用 verdict 的天数顶替
  // 会让"长期未变"的判断失真。
  const daysInCurrentLifecycle = prev ? streakLength((row) => row.lifecycle) : 0;

  // 最新在后（与 verdict.ts 的读取约定一致）。只有封存了真实档位的行才入选。
  //
  // 一次过滤、两个视图：带日期的序列是 05 §5.1 必要条件 2（"14 天内下降"）的唯一依据，
  // 无日期的那个只服务去抖与展示。两者必须来自同一份过滤结果——分别过滤会让下标
  // 错位，"哪天降的档"与"降了几档"就对不上了。拥挤度退出 W 后，不再需要第二条
  // "市场 W"序列。
  const bandRows = historyRows
    .filter((row): row is (typeof historyRows)[number] & { w_band: string } => row.w_band !== null)
    .reverse()
    .slice(-10);

  const wBandHistory = bandRows.map((row) => row.w_band as AxisBand);
  const datedWBandHistory: DatedWBand[] = bandRows.map((row) => ({
    obsDate: row.obs_date,
    band: row.w_band as AxisBand,
  }));

  // 拥挤度已退出 W（v3.1）：认领槽位不再是评分输入，`crowding_daily` 的透明度
  // 计数（verified_product_count 等）只供展示、生命周期与 CROWDING_SIGNAL 告警。
  // 该表的新列由迁移 0019 建立，但**至今没有生产者**（E3）：因此这里不传
  // `verifiedProductCount`，lifecycle 的「3+ 已验证产品 → CONTESTED」分支暂时
  // 不会成立。接线时要连同 `new_top10_entrants_30d` 一起补。

  // 拥挤透明度：写 `crowding_daily`，并把 verified_product_count 传给生命周期。
  // 两个 SERP 计数不在评分里使用，只供展示与 CROWDING_SIGNAL。
  const crowding = await computeCrowding(opp.id);
  await storeCrowding(opp.id, obsDate, crowding);

  const isFastTrack =
    historyDays >= 7 &&
    historyDays < 14 &&
    newQueries7d >= 3 &&
    clusterGrowth30d >= 0.5;

  const scoringInput: FullOpportunityScoreInput = {
    demand: {
      clusterSize: clusterRes.rows[0]?.count ?? 1,
      newQueries7d,
      clusterGrowth30d,
      expansionSlope30d: autocompleteCoverage >= 0.5 ? expansionSlope30d : 0,
      attentionSourcesActive14d,
      attentionGrowth14d,
      historyDays,
      fastTrack: isFastTrack,
    },
    window: {
      serpWeakness,
      eSpecialist30d: windowFeatures?.specialist_days ?? 0,
      eAuthoritative30d: windowFeatures?.authoritative_days ?? 0,
      volatility30d: windowFeatures?.volatility ?? 0,
      serpHistoryDays,
      recentSerpSnapshotAvailable: recentSerp,
      tier: serpTier,
      daysSinceLastSerp,
      fastTrack: isFastTrack,
    },
    commercial,
    confidence: {
      nIndependentSources: independentSourceCount,
      totalEvidenceCount: Math.max(1, historyDays + (recentSerp ? 1 : 0)),
      observedEvidenceCount: (acOutcome.status === 'OK' ? 1 : 0) + (recentSerp ? 1 : 0) + independentPricedDomains,
      medianEvidenceAgeDays,
      historyDays,
    },
    fastTrack: isFastTrack,
    // A failed collection this cycle is not evidence about the market (05 §5.0).
    criticalSourceFailure: serpOutcome.status !== 'OK' || acOutcome.status !== 'OK',
    activityRatio90d,
    verifiedProductCount: crowding.verifiedProductCount,
    recommendation: {
      queryTypes: {
        informationalRatio,
        commercialRatio,
        transactionalRatio,
        toolModifierRatio,
        templateQueryCount: toolModifier,
      },
      serpWeakness,
      specialistToolCountInSerp,
      authoritativeInTop3,
      commercialSummary: commercial,
      dBand: 'INSUFFICIENT',
      wBand: 'INSUFFICIENT',
    },
    prev: prev
      ? buildPrevScoringState({
          verdict: prev.verdict as Verdict,
          // 去抖必须看到上一期的**原始**裁决。此前这里填的是发布值，令
          // verdict.ts 的 `prev.rawVerdict === raw` 在升/降档分支里恒假，
          // 裁决从此冻结在首次发布值上。存量行缺该列时由 map 内部保守回退。
          rawVerdict: (prev.raw_verdict ?? null) as Verdict | null,
          lifecycle: prev.lifecycle as Lifecycle,
          daysInCurrentVerdict,
          daysInCurrentLifecycle,
          wBandHistory,
          datedWBandHistory,
        })
      : undefined,
    obsDate,
  };
  const output = calculateOpportunityScore(scoringInput);

  const minHistoryReq = isFastTrack ? 7 : 14;
  const publishable =
    historyDays >= minHistoryReq &&
    serpHistoryDays >= minHistoryReq &&
    recentSerp &&
    output.dBand !== 'INSUFFICIENT' &&
    output.wBand !== 'INSUFFICIENT' &&
    output.confidence !== 'LOW';

  const searchIntent = toolModifierRatio > informationalRatio && toolModifierRatio > commercialRatio
    ? 'TRANSACTIONAL'
    : commercialRatio >= informationalRatio ? 'COMMERCIAL' : 'INFORMATIONAL';
  const recommendedProductShape = opp.recommended_archetype === 'TOOL'
    ? 'TOOL'
    : opp.recommended_archetype;
  const siteStrategy = output.verdict === 'BUILD_NOW' ? 'INDEPENDENT_SITE' : 'WATCH';

  if (!publishable) {
    output.verdict = 'WATCH';
    output.rawVerdict = 'WATCH';
    output.confidence = 'LOW';
    output.dBand = historyDays >= minHistoryReq ? output.dBand : 'INSUFFICIENT';
    output.wBand = serpHistoryDays >= minHistoryReq && recentSerp ? output.wBand : 'INSUFFICIENT';
    output.mBand = commercial.band;
  }

  // 封存特征快照。既写入 opportunity_snapshots.metrics，也作为账本 features_hash 的
  // 指纹来源 —— 后者记录"当时据以判断的输入"，而不是对输出的复述。
  const featureMetrics = {
    d_score: output.dScore,
    m_score: output.mScore,
    w_score: output.wScore,
    d_band: output.dBand,
    m_band: output.mBand,
    w_band: output.wBand,
    market_w_band: output.marketWBand,
    confidence: output.confidence,
    history_days: historyDays,
    serp_history_days: serpHistoryDays,
    autocomplete_recent_days: autocompleteRecentDays,
    autocomplete_prior_days: autocompletePriorDays,
    autocomplete_coverage: autocompleteCoverage,
    autocomplete_expansion_growth: autocompleteGrowth,
    independent_source_count: independentSourceCount,
    search_intent: searchIntent,
    recommended_product_shape: recommendedProductShape,
    site_strategy: siteStrategy,
    intent_evidence: {
      source: 'autocomplete_and_serp_observations',
      informational_ratio: informationalRatio,
      commercial_ratio: commercialRatio,
      transactional_ratio: transactionalRatio,
      tool_modifier_ratio: toolModifierRatio,
      observed_date: obsDate,
    },
  };

  await query(
    `INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date, metrics, scoring_input)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (opportunity_id, obs_date) DO UPDATE SET
       metrics = EXCLUDED.metrics,
       scoring_input = COALESCE(opportunity_snapshots.scoring_input, EXCLUDED.scoring_input),
       sealed_at = NOW()`,
    [`snp_${opp.id}_${obsDate}`, opp.id, obsDate, JSON.stringify(featureMetrics), JSON.stringify(scoringInput)]
  );

  await query(
    `UPDATE opportunity_cards
     SET search_intent = $2,
         recommended_product_shape = $3,
         site_strategy = $4,
         intent_evidence = $5,
         updated_at = NOW()
     WHERE opportunity_id = $1`,
    [opp.id, searchIntent, recommendedProductShape, siteStrategy, JSON.stringify(featureMetrics.intent_evidence)]
  );

  const whyNowSummary = `Autocomplete history ${historyDays}/14 days (recent coverage ${autocompleteRecentDays}/7). Organic SERP days ${serpHistoryDays}/14. Independent sources ${independentSourceCount}. Domains with observed pricing or checkout: ${independentPricedDomains}.`;

  return {
    opportunityId: opp.id,
    slug: opp.slug,
    title: opp.title,
    primaryQuery: primary.query_text,
    output,
    velocity: newQueries7d,
    whyNowSummary,
    topIdea: publishable
      ? output.explanation.verdictReason
      : 'No build shape yet. A recommendation waits for a published BUILD NOW or EARLY BET.',
    publishable,
    previousVerdict: prev?.verdict ?? null,
    featureMetrics,
    weakResultRatio,
  };
}

async function crawlCommercialDomains(
  items: Array<{ domain: string; url: string }>,
  opportunityId: string,
  obsDate: string,
  ctx: RunContext,
  crawl: CrawlCollector
): Promise<void> {
  const considered = new Set<string>();
  for (const item of items) {
    const domain = item.domain.replace(/^www\./, '');
    if (!domain || considered.has(domain) || SKIP_COMMERCIAL_DOMAINS.some((skip) => domain === skip || domain.endsWith(`.${skip}`))) {
      continue;
    }
    if (considered.size >= COMMERCIAL_MAX_TARGETS_PER_OPP) break;
    considered.add(domain);
    const targetUrl = `https://${domain}/pricing`;

    // 07 §7 validates persistence weekly; re-fetching the same domains daily buys nothing.
    if (await hasFreshCommercialSnapshot(domain, obsDate, COMMERCIAL_STALENESS_DAYS)) continue;

    const outcome = await runCollector('src_crawl', `${opportunityId}:${domain}`, () =>
      crawl.collect(ctx, {
        targetId: `cmt_${domain.replace(/[^a-z0-9]/g, '_').slice(0, 40)}`,
        domain,
        targetUrl,
        opportunityId,
      })
    );

    // 成功与失败都计费；旧代码只在失败时记，成功抓取的成本从账本里消失了。
    if (outcome.status !== 'SKIPPED' && outcome.cost) {
      await CostLedgerService.recordCost(outcome.cost);
    }

    if (outcome.status !== 'OK') {
      // Empty and failed reads must be recorded: without them, removal of a paid tier
      // has nothing to diff against and robots-blocked targets stay in the coverage
      // denominator (07 §6.1, §11 step 5).
      await writeFailedCommercialSnapshot(opportunityId, domain, targetUrl, obsDate, {
        fetchStatus: commercialFetchStatus(outcome),
      });
      continue;
    }

    await CostLedgerService.recordCost(outcome.cost);
    const snap = outcome.snapshots[0];
    if (!snap) continue;

    const facts = factsFromCrawl(snap.data);
    const targetId = await writeCommercialSnapshot(opportunityId, domain, targetUrl, facts);
    await emitNegativesFromDiff(opportunityId, domain, targetId, obsDate, facts, crawl.sourceId);

    for (const ev of outcome.evidence) {
      await query(
        `INSERT INTO evidence (opportunity_id, evidence_class, source_type, source_id, domain, title, snippet, payload, observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          opportunityId,
          ev.evidenceClass,
          ev.sourceType,
          ev.sourceId || null,
          ev.domain || domain,
          ev.title,
          ev.snippet,
          JSON.stringify(ev.payload),
          ev.observedAt,
        ]
      );
    }
  }
}

function commercialFetchStatus(
  outcome: Extract<Awaited<ReturnType<CrawlCollector['collect']>>, { status: 'SKIPPED' | 'FAILED' }>
): FetchFailureFacts['fetchStatus'] {
  if (outcome.status === 'SKIPPED') {
    return outcome.reason === 'ROBOTS_DISALLOWED' ? 'ROBOTS_DISALLOWED' : 'BUDGET_SKIPPED';
  }
  // A dead pricing page is not a commercial signal in either direction (07 does not
  // define 404 as negative), so it must not feed the diff.
  return /HTTP 404/.test(outcome.message) ? 'BLOCKED_404' : 'FAILED';
}

