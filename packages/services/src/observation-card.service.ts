import { createHash } from 'node:crypto';
import { query } from '@emeradar/db';
import {
  CrawlCollector,
  CostLedgerService,
  RunContext,
  SerpCollector,
  type PricingPlan,
} from '@emeradar/collectors';
import type { CommercialStage } from '@emeradar/core';
import type { ResultType } from '@emeradar/scoring';
import { EXTRACTOR_VERSIONS } from './evidence-version';
import {
  factsFromCrawl,
  writeCommercialSnapshot,
  writeFailedCommercialSnapshot,
} from './pipeline/commercial-assembly';
import { classifyPage } from '@emeradar/scoring';
import { evaluateIntentFit, type IntentDecision } from './intent-fit.service';
import { storeRawPayload } from './raw-payload.service';
import { storeHtmlDerivative } from './html-derivative.service';

/**
 * 观测卡（Observation Card）。
 *
 * 产品前提：用户扫码的那一刻，**裁决**确实给不出来（一次观测不能当预测，05 §5.0），
 * 但他想知道的其实不是“该不该做”，而是“现在这个地方长什么样”：谁在占位、占了多深、
 * 有没有人在收钱。
 *
 * 这些当秒就能观测。所以把两层拆开交付：
 *   - 观测：立刻给（本文件），标注 OBSERVATION，绝不称其为建议；
 *   - 裁决：仍然需要 14 天历史，门槛一点不降。
 *
 * 采集复用既有的 SERP / Crawl 采集器，不新增数据源；所有事实写入与日常管线相同的表，
 * 因此既能回放，也能直接积累成后续裁决的历史。
 */

/** 观测卡最多探查几个竞品域名的定价。一次扫描的延迟预算由它决定。 */
export const OBSERVATION_PRICING_PROBES = 3;

/** 这些域名不是“竞品”，抓定价只会得到噪音（与日常管线同一份跳过表口径）。 */
const SKIP_DOMAINS = [
  'github.com',
  'stackoverflow.com',
  'stackexchange.com',
  'wikipedia.org',
  'news.ycombinator.com',
  'reddit.com',
  'youtube.com',
  'medium.com',
  'quora.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'amazon.com',
  'google.com',
];

export interface ObservationSerpItem {
  rank: number;
  url: string;
  domain: string;
  title: string;
  resultType: ResultType;
  /** 确定性分类器给出的页面种类。 */
  pageKind?: string;
  domainAuthorityClass: string;
  isWeak: boolean;
  weaknessType?: string;
}

/**
 * 去重后的竞争者（按域名）。
 *
 * Google 常常让同一个域名占两个位置（首页 + 子页），这不代表有两家公司在竞争。
 * 竞争面要按**域名**看，位置数只作为“这家占得多不多”的参考。
 */
export interface ObservationCompetitor {
  domain: string;
  /** 该域名出现的最好名次。 */
  bestRank: number;
  /** 它占用的所有名次。 */
  ranks: number[];
  url: string;
  title: string;
  pageKind: string;
  resultType: ResultType;
  isWeak: boolean;
  weaknessType?: string;
}

export interface ObservationPricing {
  domain: string;
  url: string;
  stage: CommercialStage | 'UNKNOWN';
  plans: PricingPlan[];
  gateways: string[];
  fetchTier: string;
  /** NOT_FOUND 是“看到了但没有公开价格”，与 BLOCKED 的“不知道”严格区分。 */
  status: 'OK' | 'NOT_FOUND' | 'BLOCKED' | 'ROBOTS' | 'NO_URL';
  note: string;
}

export interface ObservationCard {
  /** 这永远是观测，不是裁决。 */
  kind: 'OBSERVATION';
  observedAt: string;
  market: string;
  language: string;
  query: string;
  autocomplete: {
    observed: boolean;
    suggestions: string[];
    note: string;
  };
  serp: {
    available: boolean;
    provider: string | null;
    depth: number;
    items: ObservationSerpItem[];
    /** 位置数（可能同一域名占多个位）。 */
    positions: number;
    /** 去重后的竞争者数：弱点率必须用它做分母。 */
    distinctDomains: number;
    /** 每个位置都被同域重复占用时，位置数会夸大竞争面。 */
    duplicatePositions: number;
    weakCount: number;
    weakRatio: number;
    weaknessScore: number | null;
    /** 页面种类分布（确定性分类器，按域名计）。 */
    pageKindCounts: Record<string, number>;
    /** 去重后的竞争者列表：竞争面按域名看，不按位置看。 */
    competitors: ObservationCompetitor[];
    /** 按域名计的弱页数。 */
    weakDomains: number;
    /** Top10 里“为这个需求做的产品页”数量（按域名计）。 */
    dedicatedToolPages: number;
    note: string;
  };
  /** 意图适配：这个词到底是不是工具需求。 */
  intent: IntentDecision;
  pricing: {
    probed: number;
    priced: number;
    infraOnly: number;
    blocked: number;
    domains: ObservationPricing[];
    note: string;
  };
  /** 给界面直接渲染的“还缺什么才能给裁决”。 */
  verdictEta: {
    needsAutocompleteDays: number;
    needsSerpDays: number;
    reason: string;
  };
}

interface CollectInput {
  opportunityId: string;
  queryId: string;
  query: string;
  marketCountry: string;
  language: string;
  obsDate: string;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * 位置 vs 去重竞争者。
 *
 * 同一个域名占两个位置（例如首页 + 子页）不代表两家公司竞争，所以：
 *   - `competitors` 按域名去重，保留最好名次与它占的全部名次；
 *   - 弱点率、工具页数、意图判断全部按**域名**口径；
 *   - `positions` / `duplicatePositions` 保留，用于说明“这家占得多”。
 */
function serpStats(items: ObservationSerpItem[], rawKinds: string[]) {
  const byDomain = new Map<string, ObservationCompetitor>();

  items.forEach((item, index) => {
    const domain = item.domain || domainOf(item.url) || 'unknown';
    const kind = rawKinds[index] ?? item.pageKind ?? item.resultType ?? 'UNCLASSIFIED';
    const existing = byDomain.get(domain);
    if (!existing) {
      byDomain.set(domain, {
        domain,
        bestRank: item.rank,
        ranks: [item.rank],
        url: item.url,
        title: item.title,
        pageKind: kind,
        resultType: item.resultType,
        isWeak: item.isWeak,
        weaknessType: item.weaknessType,
      });
      return;
    }
    existing.ranks.push(item.rank);
    // 更好名次的那一条决定这个域名的形态：它给用户的印象由最靠前那页决定。
    if (item.rank < existing.bestRank) {
      existing.bestRank = item.rank;
      existing.url = item.url;
      existing.title = item.title;
      existing.pageKind = kind;
      existing.resultType = item.resultType;
      existing.isWeak = item.isWeak;
      existing.weaknessType = item.weaknessType;
    }
  });

  const competitors = [...byDomain.values()].sort((a, b) => a.bestRank - b.bestRank);
  const pageKindCounts: Record<string, number> = {};
  for (const competitor of competitors) {
    pageKindCounts[competitor.pageKind] = (pageKindCounts[competitor.pageKind] ?? 0) + 1;
  }

  return {
    positions: items.length,
    distinctDomains: competitors.length,
    duplicatePositions: Math.max(0, items.length - competitors.length),
    competitors,
    pageKindCounts,
    /** 按域名计的工具页数：同一个工具站占两格只算一家。 */
    dedicatedToolPages: competitors.filter((c) => c.pageKind === 'DEDICATED_TOOL').length,
    weakDomains: competitors.filter((c) => c.isWeak).length,
  };
}

function isSkipped(domain: string): boolean {
  return SKIP_DOMAINS.some((skip) => domain === skip || domain.endsWith(`.${skip}`));
}

async function runContext(obsDate: string, runId: string): Promise<RunContext> {
  return {
    runId,
    obsDate,
    clock: () => new Date(),
    budget: await CostLedgerService.createBudgetGuard(obsDate, 20),
  };
}

/** 把 SERP 结果落库，让今天的观测成为明天裁决历史的一部分（可回放、可累积）。 */
async function persistSerpObservation(
  input: CollectInput,
  outcome: Awaited<ReturnType<SerpCollector['collect']>>
): Promise<{ provider: string | null; weaknessScore: number | null; rawPayloadId: string | null }> {
  if (outcome.status !== 'OK') return { provider: null, weaknessScore: null, rawPayloadId: null };
  const snap = outcome.snapshots[0];
  if (!snap) return { provider: null, weaknessScore: null, rawPayloadId: null };

  let rawPayloadId: string | null = null;
  const runId = (outcome as { collectorRunId?: string }).collectorRunId;
  if (outcome.raw && runId) {
    try {
      const stored = await storeRawPayload({
        collectorRunId: runId,
        sourceId: 'src_serp',
        provider: snap.data.provider ?? 'UNKNOWN',
        obsDate: input.obsDate,
        content: outcome.raw.content,
        mimeType: outcome.raw.mimeType,
        requestParams: {
          query: input.query,
          marketCountry: input.marketCountry,
          language: input.language,
          depth: snap.data.depth ?? 10,
        },
        locale: input.language,
      });
      rawPayloadId = stored?.id ?? null;
    } catch {
      // 归档失败不影响观测本身。
    }
  }

  const snapshotId = snap.key as string;
  await query(
    `INSERT INTO serp_snapshots
       (id, query_id, obs_date, weak_result_ratio, depth, result_count, provider, raw_payload_id, weakness_score, sampling_reason)
     VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,'SCAN_IMMEDIATE')
     ON CONFLICT (query_id, obs_date) DO UPDATE SET
       weak_result_ratio = EXCLUDED.weak_result_ratio,
       depth = EXCLUDED.depth,
       result_count = EXCLUDED.result_count,
       provider = EXCLUDED.provider,
       raw_payload_id = COALESCE(EXCLUDED.raw_payload_id, serp_snapshots.raw_payload_id),
       weakness_score = EXCLUDED.weakness_score,
       sampling_reason = EXCLUDED.sampling_reason`,
    [
      snapshotId,
      input.queryId,
      input.obsDate,
      snap.data.weakResultRatio,
      snap.data.depth,
      snap.data.resultCount,
      snap.data.provider ?? 'UNKNOWN',
      rawPayloadId,
      snap.data.weaknessScore ?? null,
    ]
  );

  await query(`DELETE FROM serp_results WHERE serp_snapshot_id = $1`, [snapshotId]);
  for (const item of (snap.data.items ?? []) as any[]) {
    await query(
      `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title, snippet, result_type, domain_authority_class, is_weak, weakness_type, page_kind, classifier_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
        item.pageKind ?? null,
        item.classifierVersion ?? null,
      ]
    );
  }

  return {
    provider: snap.data.provider ?? null,
    weaknessScore: snap.data.weaknessScore ?? null,
    rawPayloadId,
  };
}

/** 探查一个域名的公开定价；PRICED 与 INFRA 的区别就是“收钱”和“能收钱”。 */
async function probePricing(
  input: CollectInput,
  domain: string,
  crawl: CrawlCollector,
  ctx: RunContext
): Promise<ObservationPricing> {
  const targetUrl = await crawl.discoverPricingUrl(domain).catch(() => `https://${domain}/pricing`);
  let outcome: Awaited<ReturnType<CrawlCollector['collect']>>;
  try {
    outcome = await crawl.collect(ctx, {
      targetId: `cmt_${domain.replace(/[^a-z0-9]/g, '_').slice(0, 40)}`,
      domain,
      targetUrl,
      opportunityId: input.opportunityId,
    });
  } catch (error) {
    return {
      domain,
      url: targetUrl,
      stage: 'UNKNOWN',
      plans: [],
      gateways: [],
      fetchTier: 'STATIC',
      status: 'BLOCKED',
      note: `Fetch failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  if (outcome.status === 'SKIPPED') {
    await writeFailedCommercialSnapshot(input.opportunityId, domain, targetUrl, input.obsDate, {
      fetchStatus: outcome.reason === 'ROBOTS_DISALLOWED' ? 'ROBOTS_DISALLOWED' : 'BUDGET_SKIPPED',
    }).catch(() => null);
    return {
      domain,
      url: targetUrl,
      stage: 'UNKNOWN',
      plans: [],
      gateways: [],
      fetchTier: 'STATIC',
      status: outcome.reason === 'ROBOTS_DISALLOWED' ? 'ROBOTS' : 'BLOCKED',
      note:
        outcome.reason === 'ROBOTS_DISALLOWED'
          ? 'robots.txt disallows crawling — treated as unknown, not as “no pricing”.'
          : 'Skipped by budget or policy — treated as unknown.',
    };
  }
  if (outcome.status === 'FAILED') {
    const blocked404 = /HTTP 404/.test(outcome.message);
    await writeFailedCommercialSnapshot(input.opportunityId, domain, targetUrl, input.obsDate, {
      fetchStatus: blocked404 ? 'BLOCKED_404' : 'FAILED',
    }).catch(() => null);
    return {
      domain,
      url: targetUrl,
      stage: 'UNKNOWN',
      plans: [],
      gateways: [],
      fetchTier: 'STATIC',
      status: blocked404 ? 'NOT_FOUND' : 'BLOCKED',
      note: blocked404
        ? 'No pricing page at the discovered URL — this is “not found”, not “no pricing”.'
        : `Fetch failed (${outcome.message}). Treated as unknown, not as “no pricing”.`,
    };
  }

  const snap = outcome.snapshots[0];
  const plans = (snap?.data?.pricingPlans ?? []) as PricingPlan[];
  const gateways = (snap?.data?.paymentGateways ?? []) as string[];
  const stage = (snap?.data?.commercialStage ?? 'NONE') as CommercialStage;

  // 归档原始 HTML + 派生，保证“这条价格从哪份页面来”可回答。
  let rawPayloadId: string | null = null;
  const runId = (outcome as { collectorRunId?: string }).collectorRunId;
  if (outcome.raw && runId) {
    try {
      const stored = await storeRawPayload({
        collectorRunId: runId,
        sourceId: 'src_crawl',
        provider: 'DIRECT_HTTP',
        obsDate: input.obsDate,
        content: outcome.raw.content,
        mimeType: outcome.raw.mimeType,
        requestParams: { domain, url: targetUrl, source: 'LIVE_SCAN' },
      });
      rawPayloadId = stored?.id ?? null;
      if (rawPayloadId && outcome.raw.mimeType.includes('html')) {
        await storeHtmlDerivative(rawPayloadId, outcome.raw.content).catch(() => null);
      }
    } catch {
      // 归档失败不影响观测本身。
    }
  }

  // 只在真的观测到付费档位或网关时写证据：失败不是负证据。
  if (plans.length > 0 || gateways.length > 0) {
    await query(
      `INSERT INTO evidence (opportunity_id, evidence_class, source_type, source_id, domain, title, snippet, payload, observed_at, raw_payload_id, extractor_version)
       VALUES ($1,'OBSERVED',$2,'src_crawl',$3,$4,$5,$6,NOW(),$7,$8)`,
      [
        input.opportunityId,
        plans.length > 0 ? 'PAID_TIER_OBSERVED' : 'PAYMENT_INFRA_DETECTED',
        domain,
        plans.length > 0 ? `Public pricing observed on ${domain}` : `Checkout gateway observed on ${domain}`,
        plans.length > 0
          ? plans.map((plan) => `${plan.name}: ${plan.currency}${plan.priceMonthly ?? '?'}/mo`).join(', ')
          : `Gateway(s): ${gateways.join(', ')} with no public pricing table.`,
        JSON.stringify({ plans, gateways, stage, fetchTier: snap?.data?.fetchTier ?? 'STATIC', source: 'LIVE_SCAN' }),
        rawPayloadId,
        EXTRACTOR_VERSIONS.COMMERCIAL,
      ]
    );
  }

  // 落库：扫码的定价观测必须持久。
  // 之前只写 evidence + 原始载荷，没写 commercial_targets/snapshots，于是刷新后
  // 定价一栏永远是「探查 0」——观测卡看起来像没工作，其实是没存。
  try {
    const facts = factsFromCrawl(snap.data);
    await writeCommercialSnapshot(input.opportunityId, domain, targetUrl, facts, rawPayloadId);
  } catch (error) {
    console.warn(
      `[observation] commercial snapshot persist failed for ${domain}:`,
      error instanceof Error ? error.message : error
    );
  }

  return {
    domain,
    url: targetUrl,
    stage,
    plans,
    gateways,
    fetchTier: (snap?.data?.fetchTier ?? 'STATIC') as string,
    status: plans.length > 0 ? 'OK' : 'NOT_FOUND',
    note:
      plans.length > 0
        ? 'Public paid tiers found.'
        : gateways.length > 0
        ? 'Checkout gateway present but no public pricing table — cannot be counted as paid proof.'
        : 'Page read successfully; no public pricing found.',
  };
}

/**
 * 采集一次观测。调用方负责确保这发生在用户扫码路径上，因此延迟预算绑定在
 * `OBSERVATION_PRICING_PROBES` 上，而不是把整个 Top10 都抓一遍。
 */
export async function collectObservationCard(
  input: CollectInput,
  options: { serp: SerpCollector; crawl: CrawlCollector; autocompleteObserved: boolean; suggestions: string[] }
): Promise<ObservationCard> {
  const ctx = await runContext(input.obsDate, `scan_${input.opportunityId}`);

  const serpOutcome = await options.serp.collect(ctx, {
    queryId: input.queryId,
    queryText: input.query,
    opportunityId: input.opportunityId,
    marketCountry: input.marketCountry,
    researchLanguage: input.language,
    depth: 10,
  });

  const persisted = await persistSerpObservation(input, serpOutcome);
  const snap = serpOutcome.status === 'OK' ? serpOutcome.snapshots[0] : undefined;
  const items: ObservationSerpItem[] = ((snap?.data?.items ?? []) as any[]).map((item) => ({
    rank: item.rank,
    url: item.url,
    domain: item.domain,
    title: item.title,
    resultType: item.resultType,
    domainAuthorityClass: item.domainAuthorityClass,
    isWeak: item.isWeak,
    weaknessType: item.weaknessType,
  }));

  // 定价探查只对前几个真实竞品域名做，且跳过论坛/百科/大平台。
  const targets: string[] = [];
  for (const item of items) {
    if (targets.length >= OBSERVATION_PRICING_PROBES) break;
    const domain = item.domain || domainOf(item.url);
    if (!domain || isSkipped(domain) || targets.includes(domain)) continue;
    targets.push(domain);
  }

  const pricing: ObservationPricing[] = [];
  for (const domain of targets) {
    pricing.push(await probePricing(input, domain, options.crawl, ctx));
  }

  const priced = pricing.filter((row) => row.plans.length > 0).length;
  const infraOnly = pricing.filter((row) => row.plans.length === 0 && row.gateways.length > 0).length;
  const blocked = pricing.filter((row) => row.status === 'BLOCKED' || row.status === 'ROBOTS').length;

  // 与读路径同一口径：有公开付费档位的域名升级为 DEDICATED_TOOL。
  const pricedDomainsSet = new Set(pricing.filter((row) => row.plans.length > 0).map((row) => row.domain));
  const rawKinds = ((snap?.data?.items ?? []) as any[]).map((item) => {
    const domain = item.domain ?? domainOf(item.url);
    if (pricedDomainsSet.has(domain)) return 'DEDICATED_TOOL';
    return item.pageKind ?? item.resultType ?? 'UNCLASSIFIED';
  });
  const stats = serpStats(items, rawKinds);
  const intent = evaluateIntentFit({
    query: input.query,
    pageKinds: rawKinds,
    pricedDomains: priced,
    blockedDomains: blocked,
    probedDomains: pricing.length,
  });

  return {
    kind: 'OBSERVATION',
    observedAt: new Date().toISOString(),
    market: input.marketCountry,
    language: input.language,
    query: input.query,
    autocomplete: {
      observed: options.autocompleteObserved,
      suggestions: options.suggestions,
      note: options.autocompleteObserved
        ? 'Live Google Autocomplete suggestions for this query.'
        : 'Autocomplete was unavailable for this query. A failed fetch is not evidence of zero demand.',
    },
    serp: {
      available: serpOutcome.status === 'OK',
      provider: persisted.provider,
      depth: (snap?.data?.depth ?? 10) as number,
      items,
      ...stats,
      weakCount: items.filter((item) => item.isWeak).length,
      weakRatio: (snap?.data?.weakResultRatio ?? 0) as number,
      weaknessScore: persisted.weaknessScore,
      note:
        serpOutcome.status === 'OK'
          ? 'Google organic Top 10 as returned by the configured provider.'
          : 'No organic SERP provider returned results. Competition is unknown, not weak.',
    },
    intent,
    pricing: {
      probed: pricing.length,
      priced,
      infraOnly,
      blocked,
      domains: pricing,
      note:
        pricing.length === 0
          ? 'No competitor domain was available to probe for public pricing.'
          : 'Public pricing observation only. Absence of pricing is not proof of no willingness to pay.',
    },
    verdictEta: {
      needsAutocompleteDays: 14,
      needsSerpDays: 14,
      reason:
        'A published BUILD NOW / EARLY BET needs 14 days of autocomplete and 14 days of organic SERP history. One observation cannot be a prediction.',
    },
  };
}

/** 已有机会：读最近一次已入库的观测，不重新抓取（用户看的是同一份事实）。 */
export async function loadObservationCard(
  opportunityId: string,
  queryId: string | null,
  queryText: string,
  marketCountry: string,
  language: string
): Promise<ObservationCard> {
  const itemsRes = queryId
    ? await query<any>(
        `SELECT sr.rank, sr.url, sr.domain, sr.title, sr.result_type, sr.page_kind,
                sr.domain_authority_class, sr.is_weak, sr.weakness_type
           FROM serp_results sr
           JOIN serp_snapshots ss ON ss.id = sr.serp_snapshot_id
          WHERE ss.query_id = $1
          ORDER BY ss.obs_date DESC, sr.rank
          LIMIT 10`,
        [queryId]
      )
    : { rows: [] as any[] };

  const snapshotRes = queryId
    ? await query<any>(
        `SELECT weak_result_ratio, depth, provider, weakness_score, obs_date::text
           FROM serp_snapshots WHERE query_id = $1 ORDER BY obs_date DESC LIMIT 1`,
        [queryId]
      )
    : { rows: [] as any[] };

  const acRes = queryId
    ? await query<{ suggestions: string[]; observed_date: string }>(
        `SELECT suggestions, observed_date::text FROM autocomplete_observations
          WHERE query_id = $1 ORDER BY observed_date DESC LIMIT 1`,
        [queryId]
      )
    : { rows: [] as Array<{ suggestions: string[]; observed_date: string }> };

  // 定价：读该机会下每个域名最近一次商业快照，而不是重抓。
  const pricingRes = await query<any>(
    `SELECT DISTINCT ON (ct.domain)
            ct.domain, ct.target_url, cs.pricing_plans, cs.payment_gateways,
            cs.commercial_stage, cs.fetch_status, cs.fetch_tier
       FROM commercial_target_opportunities cto
       JOIN commercial_targets ct ON ct.id = cto.commercial_target_id
       JOIN commercial_snapshots cs ON cs.commercial_target_id = ct.id
      WHERE cto.opportunity_id = $1
      ORDER BY ct.domain, cs.obs_date DESC`,
    [opportunityId]
  );

  // 读时重算分类。
  //
  // 分类是 (url, title, snippet) 的**纯函数**，所以历史行也可以按当前规则重新解释，
  // 不需要先把库改一遍。这样修好规则后，旧快照立刻显示正确标签；
  // 库里存的 `page_kind/classifier_version` 仍然保留，用于审计“当时是哪一版”。
  const items: ObservationSerpItem[] = itemsRes.rows.map((row) => {
    const classification = classifyPage(row.url, row.title, '');
    return {
      rank: row.rank,
      url: row.url,
      domain: row.domain,
      title: row.title,
      resultType: classification.resultType,
      pageKind: classification.kind,
      domainAuthorityClass: row.domain_authority_class,
      isWeak: row.is_weak,
      weaknessType: row.weakness_type ?? undefined,
    };
  });

  const pricing: ObservationPricing[] = pricingRes.rows.map((row) => {
    const plans = (row.pricing_plans ?? []) as PricingPlan[];
    const gateways = (row.payment_gateways ?? []) as string[];
    const status: ObservationPricing['status'] =
      row.fetch_status === 'ROBOTS_DISALLOWED'
        ? 'ROBOTS'
        : row.fetch_status === 'BLOCKED_404'
        ? 'NOT_FOUND'
        : row.fetch_status === 'OK'
        ? plans.length > 0
          ? 'OK'
          : 'NOT_FOUND'
        : 'BLOCKED';
    return {
      domain: row.domain,
      url: row.target_url,
      stage: (row.commercial_stage ?? 'UNKNOWN') as ObservationPricing['stage'],
      plans,
      gateways,
      fetchTier: row.fetch_tier ?? 'STATIC',
      status,
      note:
        status === 'OK'
          ? 'Public paid tiers found.'
          : status === 'NOT_FOUND'
          ? 'Page read successfully; no public pricing found.'
          : 'Could not be observed — treated as unknown, not as “no pricing”.',
    };
  });

  // 有公开付费档位的域名，本身就是“为这个需求做的商业产品页”的正面证据：
  // 首页类工具站没有 /pricing 路径，单看 URL 会判成 UNCLASSIFIED，把工具需求误判成信息型。
  const pricedDomainSet = new Set(
    pricing.filter((row) => row.plans.length > 0).map((row) => row.domain)
  );
  const rawKinds = items.map((item) => {
    if (pricedDomainSet.has(item.domain)) return 'DEDICATED_TOOL';
    return item.pageKind ?? item.resultType ?? 'UNCLASSIFIED';
  });
  const stats = serpStats(items, rawKinds);
  const intent = evaluateIntentFit({
    query: queryText,
    pageKinds: rawKinds,
    pricedDomains: pricing.filter((row) => row.plans.length > 0).length,
    blockedDomains: pricing.filter((row) => row.status === 'BLOCKED' || row.status === 'ROBOTS').length,
    probedDomains: pricing.length,
  });

  const snapshot = snapshotRes.rows[0];
  return {
    kind: 'OBSERVATION',
    observedAt: snapshot?.obs_date ?? new Date().toISOString().slice(0, 10),
    market: marketCountry,
    language,
    query: queryText,
    autocomplete: {
      observed: Boolean(acRes.rows[0]),
      suggestions: acRes.rows[0]?.suggestions ?? [],
      note: acRes.rows[0]
        ? `Most recent suggestion set (${acRes.rows[0].observed_date}).`
        : 'No autocomplete observation stored yet.',
    },
    serp: {
      available: items.length > 0,
      provider: snapshot?.provider ?? null,
      depth: snapshot?.depth ?? 10,
      items,
      ...stats,
      weakCount: items.filter((item) => item.isWeak).length,
      weakRatio: Number(snapshot?.weak_result_ratio ?? 0),
      weaknessScore: snapshot?.weakness_score !== null && snapshot?.weakness_score !== undefined
        ? Number(snapshot.weakness_score)
        : null,
      // “没观测到”必须说清楚是“不知道”，否则界面很容易把它读成“Top10 很干净”。
      note: items.length > 0
        ? 'Most recent stored organic Top 10.'
        : 'No organic SERP observation stored yet. Competition is unknown, not weak.',
    },
    pricing: {
      probed: pricing.length,
      priced: pricing.filter((row) => row.plans.length > 0).length,
      infraOnly: pricing.filter((row) => row.plans.length === 0 && row.gateways.length > 0).length,
      blocked: pricing.filter((row) => row.status === 'BLOCKED' || row.status === 'ROBOTS').length,
      domains: pricing,
      note: 'Public pricing observation only. Absence of pricing is not proof of no willingness to pay.',
    },
    intent,
    verdictEta: {
      needsAutocompleteDays: 14,
      needsSerpDays: 14,
      reason:
        'A published BUILD NOW / EARLY BET needs 14 days of autocomplete and 14 days of organic SERP history. One observation cannot be a prediction.',
    },
  };
}

/** 观测卡的内容指纹，便于判断“今天看到的是不是和昨天同一份事实”。 */
export function observationFingerprint(card: ObservationCard): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        serp: card.serp.items.map((item) => item.url),
        pricing: card.pricing.domains.map((row) => [row.domain, row.status, row.plans.length]),
        ac: card.autocomplete.suggestions,
      })
    )
    .digest('hex');
}
