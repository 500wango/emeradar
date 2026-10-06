import { query, transaction } from '@emeradar/db';
import { calculateOpportunityScore, CommercialSummary } from '@emeradar/scoring';
import {
  AutocompleteCollector,
  CrawlCollector,
  RunContext,
  SerpCollector,
} from '@emeradar/collectors';

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
  const qryRes = await query<{ id: string; query_text: string }>(
    `SELECT q.id, q.query_text FROM opportunity_queries oq
     JOIN queries q ON q.id = oq.query_id
     WHERE oq.opportunity_id = $1 AND oq.role = 'PRIMARY'`,
    [opp.id]
  );
  const primary = qryRes.rows[0];
  if (!primary) return null;

  const acOutcome = await collectors.autocomplete.collect(ctx, {
    queryId: primary.id,
    queryText: primary.query_text,
    opportunityId: opp.id,
    marketCountry: opp.market_country,
    language: opp.research_language,
  });

  if (acOutcome.status === 'OK') {
    const snap = acOutcome.snapshots[0];
    if (snap) {
      await query(
        `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions, depth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (query_id, observed_date) DO UPDATE SET
           suggestions = EXCLUDED.suggestions,
           depth = EXCLUDED.depth`,
        [primary.id, obsDate, snap.data.suggestions, snap.data.depth]
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
  const trend = trendRes.rows[0];
  const autocompleteRecentDays = trend?.recent_days ?? 0;
  const autocompletePriorDays = trend?.prior_days ?? 0;
  const autocompleteCoverage = Math.min(1, autocompleteRecentDays / 7);
  const autocompleteGrowth = trend?.prior_avg && trend.prior_avg > 0
    ? (trend.recent_avg - trend.prior_avg) / trend.prior_avg
    : null;

  const serpOutcome = await collectors.serp.collect(ctx, {
    queryId: primary.id,
    queryText: primary.query_text,
    opportunityId: opp.id,
    marketCountry: opp.market_country,
    researchLanguage: opp.research_language,
  });

  let serpWeakness = 0;
  let organicItems: Array<{ domain: string; url: string }> = [];
  if (serpOutcome.status === 'OK') {
    const serpSnap = serpOutcome.snapshots[0];
    if (serpSnap) {
      serpWeakness = serpSnap.data.weaknessScore;
      organicItems = serpSnap.data.items || [];
      const snapRes = await query<{ id: string }>(
        `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (query_id, obs_date) DO UPDATE SET
           weak_result_ratio = EXCLUDED.weak_result_ratio
         RETURNING id`,
        [serpSnap.key, primary.id, obsDate, serpSnap.data.weakResultRatio]
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
    }
  }

  const serpHistoryRes = await query<{ days: number; recent: boolean }>(
    `SELECT COUNT(DISTINCT obs_date)::int AS days,
            BOOL_OR(obs_date = $2::date) AS recent
     FROM serp_snapshots
     WHERE query_id = $1 AND obs_date <= $2::date`,
    [primary.id, obsDate]
  );
  const serpHistoryDays = serpHistoryRes.rows[0]?.days ?? 0;
  const recentSerp = Boolean(serpHistoryRes.rows[0]?.recent);

  const commercialCrawl = await crawlCommercialDomains(
    organicItems,
    opp.id,
    obsDate,
    ctx,
    collectors.crawl
  );

  const commercial = commercialSummary(commercialCrawl);
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
    crowding: number;
  }>(
    `WITH recent AS (
       SELECT s.id, s.weak_result_ratio,
              COUNT(*) FILTER (WHERE r.result_type = 'SPECIALIST')::float AS specialist_count,
              COUNT(*) FILTER (WHERE r.result_type IN ('OFFICIAL', 'DOC'))::float AS authoritative_count,
              COUNT(r.rank)::float AS result_count
       FROM serp_snapshots s
       LEFT JOIN serp_results r ON r.serp_snapshot_id = s.id AND r.rank <= 10
       WHERE s.query_id = $1 AND s.obs_date > $2::date - 30 AND s.obs_date <= $2::date
       GROUP BY s.id, s.weak_result_ratio
     )
     SELECT
       COUNT(*) FILTER (WHERE specialist_count > 0)::int AS specialist_days,
       COUNT(*) FILTER (WHERE authoritative_count > 0)::int AS authoritative_days,
       COALESCE(stddev_pop(weak_result_ratio) * 100, 0)::float AS volatility,
       COALESCE(AVG(CASE WHEN result_count > 0
         THEN ((specialist_count + authoritative_count) / result_count) * 100
         ELSE 0 END), 0)::float AS crowding
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

  const prevRes = await query<{ verdict: string; lifecycle: string; obs_date: string; w_band: string }>(
    `SELECT v.verdict, v.lifecycle, v.obs_date::text,
            COALESCE(c.w_band, 'INSUFFICIENT') AS w_band
     FROM verdicts v LEFT JOIN opportunity_cards c ON c.opportunity_id = v.opportunity_id
     WHERE v.opportunity_id = $1 AND v.obs_date < $2
     ORDER BY v.obs_date DESC LIMIT 1`,
    [opp.id, obsDate]
  );
  const prev = prevRes.rows[0];

  const independentSourceCount = (acOutcome.status === 'OK' ? 1 : 0) +
    (recentSerp ? 1 : 0) + (commercialCrawl.pricedDomains > 0 ? 1 : 0) + (attentionSourcesActive14d > 1 ? 1 : 0);

  const historyRes = await query<{ verdict: string; lifecycle: string; w_band: string }>(
    `SELECT v.verdict, v.lifecycle, COALESCE(c.w_band, 'INSUFFICIENT') AS w_band
     FROM verdicts v LEFT JOIN opportunity_cards c ON c.opportunity_id = v.opportunity_id
     WHERE v.opportunity_id = $1 AND v.obs_date < $2
     ORDER BY v.obs_date DESC LIMIT 30`,
    [opp.id, obsDate]
  );
  const daysInCurrentVerdict = prev
    ? historyRes.rows.findIndex((row) => row.verdict !== prev.verdict) < 0
      ? historyRes.rows.length + 1
      : Math.max(1, historyRes.rows.findIndex((row) => row.verdict !== prev.verdict) + 1)
    : 0;
  const wBandHistory = historyRes.rows.map((row) => row.w_band).reverse().slice(-10) as any[];

  const output = calculateOpportunityScore({
    demand: {
      clusterSize: clusterRes.rows[0]?.count ?? 1,
      newQueries7d,
      clusterGrowth30d,
      expansionSlope30d: autocompleteCoverage >= 0.5 ? expansionSlope30d : 0,
      attentionSourcesActive14d,
      attentionGrowth14d,
      historyDays,
    },
    window: {
      serpWeakness,
      eSpecialist30d: windowFeatures?.specialist_days ?? 0,
      eAuthoritative30d: windowFeatures?.authoritative_days ?? 0,
      volatility30d: windowFeatures?.volatility ?? 0,
      crowdingIndex: windowFeatures?.crowding ?? 0,
      serpHistoryDays,
      recentSerpSnapshotAvailable: recentSerp,
    },
    commercial,
    confidence: {
      nIndependentSources: independentSourceCount,
      totalEvidenceCount: Math.max(1, historyDays + (recentSerp ? 1 : 0)),
      observedEvidenceCount: (acOutcome.status === 'OK' ? 1 : 0) + (recentSerp ? 1 : 0) + commercialCrawl.pricedDomains,
      medianEvidenceAgeDays,
      historyDays,
    },
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
      ? {
          verdict: prev.verdict as any,
          rawVerdict: prev.verdict as any,
          lifecycle: prev.lifecycle as any,
          daysInCurrentVerdict,
          daysInCurrentLifecycle: daysInCurrentVerdict,
          wBandHistory,
        }
      : undefined,
  });

  const publishable =
    historyDays >= 14 &&
    serpHistoryDays >= 14 &&
    recentSerp &&
    output.dBand !== 'INSUFFICIENT' &&
    output.wBand !== 'INSUFFICIENT' &&
    output.confidence !== 'LOW';

  const searchIntent = toolModifierRatio > informationalRatio && toolModifierRatio > commercialRatio
    ? 'TRANSACTIONAL'
    : commercialRatio >= informationalRatio ? 'COMMERCIAL' : 'INFORMATIONAL';
  const recommendedProductShape = opp.recommended_archetype === 'LIGHTWEIGHT_TOOL'
    ? 'LIGHTWEIGHT_TOOL'
    : opp.recommended_archetype;
  const siteStrategy = output.verdict === 'BUILD_NOW' ? 'INDEPENDENT_SITE' : 'WATCH';

  if (!publishable) {
    output.verdict = 'WATCH';
    output.rawVerdict = 'WATCH';
    output.confidence = 'LOW';
    output.dBand = historyDays >= 14 ? output.dBand : 'INSUFFICIENT';
    output.wBand = serpHistoryDays >= 14 && recentSerp ? output.wBand : 'INSUFFICIENT';
    output.mBand = commercial.band;
  }

  await query(
    `INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date, metrics)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (opportunity_id, obs_date) DO UPDATE SET
       metrics = EXCLUDED.metrics,
       sealed_at = NOW()`,
    [
      `snp_${opp.id}_${obsDate}`,
      opp.id,
      obsDate,
      JSON.stringify({
        d_score: output.dScore,
        m_score: output.mScore,
        w_score: output.wScore,
        d_band: output.dBand,
        m_band: output.mBand,
        w_band: output.wBand,
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
      }),
    ]
  );

  await query(
    `UPDATE opportunity_cards
     SET search_intent = $2,
         recommended_product_shape = $3,
         site_strategy = $4,
         intent_evidence = $5,
         updated_at = NOW()
     WHERE opportunity_id = $1`,
    [opp.id, searchIntent, recommendedProductShape, siteStrategy, JSON.stringify({
      source: 'autocomplete_and_serp_observations',
      informational_ratio: informationalRatio,
      commercial_ratio: commercialRatio,
      transactional_ratio: transactionalRatio,
      tool_modifier_ratio: toolModifierRatio,
      observed_date: obsDate,
    })]
  );

  const whyNowSummary = `Autocomplete history ${historyDays}/14 days (recent coverage ${autocompleteRecentDays}/7). Organic SERP days ${serpHistoryDays}/14. Independent sources ${independentSourceCount}. Domains with observed pricing or checkout: ${commercialCrawl.pricedDomains}.`;

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
  };
}

async function crawlCommercialDomains(
  items: Array<{ domain: string; url: string }>,
  opportunityId: string,
  obsDate: string,
  ctx: RunContext,
  crawl: CrawlCollector
): Promise<CommercialCrawlResult> {
  const seen = new Set<string>();
  const gateways = new Set<string>();
  let priced = 0;
  let subscription = 0;
  for (const item of items) {
    const domain = item.domain.replace(/^www\./, '');
    if (!domain || seen.has(domain) || SKIP_COMMERCIAL_DOMAINS.some((skip) => domain === skip || domain.endsWith(`.${skip}`))) {
      continue;
    }
    seen.add(domain);
    if (seen.size > 3) break;
    const outcome = await crawl.collect(ctx, {
      targetId: `cmt_${domain.replace(/[^a-z0-9]/g, '_').slice(0, 40)}`,
      domain,
      targetUrl: `https://${domain}/pricing`,
      opportunityId,
    });
    if (outcome.status !== 'OK') continue;
    const snap = outcome.snapshots[0];
    const plans = snap?.data.pricingPlans || [];
    const gateways = snap?.data.paymentGateways || [];
    if (plans.length === 0 && gateways.length === 0) continue;
    priced += 1;
    if (plans.some((p: { billingPeriod?: string }) => p.billingPeriod === 'monthly' || p.billingPeriod === 'yearly')) {
      subscription += 1;
    }
    for (const g of gateways) gateways.add(g);
    await query(
      `INSERT INTO commercial_targets (id, domain, target_url, last_crawled_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (domain) DO UPDATE SET last_crawled_at = NOW(), target_url = EXCLUDED.target_url`,
      [`cmt_${domain.replace(/[^a-z0-9]/g, '_').slice(0, 48)}`, domain, `https://${domain}/pricing`]
    );
    await query(
      `INSERT INTO commercial_snapshots (commercial_target_id, obs_date, pricing_plans, payment_gateways, commercial_stage)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (commercial_target_id, obs_date) DO UPDATE SET
         pricing_plans = EXCLUDED.pricing_plans,
         payment_gateways = EXCLUDED.payment_gateways,
         commercial_stage = EXCLUDED.commercial_stage,
         created_at = NOW()`,
      [
        `cmt_${domain.replace(/[^a-z0-9]/g, '_').slice(0, 48)}`,
        obsDate,
        JSON.stringify(plans),
        gateways,
        snap?.data.commercialStage || 'NONE',
      ]
    );
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
  return {
    pricedDomains: priced,
    subscriptionDomains: subscription,
    distinctGateways: Array.from(gateways),
  };
}

interface CommercialCrawlResult {
  pricedDomains: number;
  subscriptionDomains: number;
  distinctGateways: string[];
}

function commercialSummary(crawl: CommercialCrawlResult): CommercialSummary {
  const { pricedDomains, subscriptionDomains, distinctGateways } = crawl;
  // HIGH is deliberately hard to reach: at most 3 SERP domains are crawled, so this
  // requires ALL of them to be monetized, ≥2 with recurring billing, and ≥2 distinct
  // payment gateways (i.e. not one vendor's ecosystem). This keeps BUILD_NOW rare,
  // matching the PRD's high-precision bar for the top verdict.
  const band =
    pricedDomains >= 3 && subscriptionDomains >= 2 && distinctGateways.length >= 2
      ? 'HIGH'
      : pricedDomains >= 2
        ? 'MEDIUM'
        : pricedDomains === 1
          ? 'LOW'
          : 'INSUFFICIENT';
  return {
    band,
    independentDomainsCount: pricedDomains,
    hasSubscriptionPlans: subscriptionDomains > 0,
    hasOneTimePlans: false,
    hasStrongNegative: false,
    totalScore: band === 'HIGH' ? 8500 : band === 'MEDIUM' ? 5500 : band === 'LOW' ? 2500 : 0,
  };
}
