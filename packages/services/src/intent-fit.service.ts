/**
 * 意图适配（intent_fit）：这个词到底是「想买工具」还是「想了解知识」。
 *
 * 不用 LLM 做主判据，理由不是省钱，而是**可复现**：意图会进 W 轴与候选准入，
 * 如果判定依赖一次模型调用，同一个词换个时间问就可能翻转，14 天的序列就断了。
 *
 * 三条证据，全部可观测/可枚举：
 *   1. 词面修饰词（generator/converter/tool/price/vs…）——可枚举，零成本；
 *   2. Top10 里**专属产品页**的占比——SERP 形态本身就是搜索引擎对意图的判断；
 *   3. 前排是否有人在收费——商业存在性。
 *
 * 输出三档，故意保守：
 *   TOOL_INTENT          证据一致指向工具需求
 *   INFORMATIONAL        SERP 被 UGC/内容/泛平台占满，且几乎没人收费
 *   INSUFFICIENT         证据不足——明确“不知道”，不硬判
 */
export const INTENT_RULE_VERSION = 'intent-fit-v1';

export type IntentFit = 'TOOL_INTENT' | 'INFORMATIONAL' | 'INSUFFICIENT';

/** 工具意图修饰词（与种子入口过滤共用同一套语义）。 */
const TOOL_MODIFIERS =
  /\b(generator|calculator|converter|convert|template|checker|maker|estimator|planner|tracker|alternative|extension|api|plugin|integration|dashboard|monitor|scheduler|scraper|extractor|summarizer|workflow|compliance|tool|tools|software|app|platform|automation|builder|editor|manager|assistant|crm|erp|saas)\b/i;

/** 明确的信息型前缀。 */
const INFORMATIONAL_MODIFIERS = /^(how to|what is|what are|why |is there|best |top \d+|guide to|learn )/i;
const DEFINITIONAL = /\b(definition|meaning|explained|examples?|full form)\b/i;

export interface IntentSignals {
  query: string;
  /** Top10 里页面种类分布（classifier 的 PageKind）。 */
  pageKinds: string[];
  /** 前排探查过的域名里，有多少抓到了公开付费档位。 */
  pricedDomains: number;
  /** 探查失败的域名数——它们不代表“没人收费”。 */
  blockedDomains: number;
  /** 供应商给的 main_intent（第三方估计，只作参考，不作判据）。 */
  vendorIntent?: string | null;
}

export interface IntentDecision {
  intentFit: IntentFit;
  /** 0–1，仅用于排序与展示，不直接进分档。 */
  score: number;
  signals: {
    toolModifier: boolean;
    informationalModifier: boolean;
    dedicatedToolPages: number;
    distinctDomains: number;
    toolPageShare: number;
    pricedDomains: number;
    blockedDomains: number;
    vendorIntent: string | null;
  };
  reason: string;
  ruleVersion: string;
}

const TOOL_KINDS = new Set(['DEDICATED_TOOL']);

export function evaluateIntentFit(input: IntentSignals): IntentDecision {
  const query = input.query.toLowerCase();
  const toolModifier = TOOL_MODIFIERS.test(query);
  const informationalModifier = INFORMATIONAL_MODIFIERS.test(query) || DEFINITIONAL.test(query);

  const dedicatedToolPages = input.pageKinds.filter((kind) => TOOL_KINDS.has(kind)).length;
  const distinctDomains = input.pageKinds.length;
  const toolPageShare = distinctDomains > 0 ? dedicatedToolPages / distinctDomains : 0;

  const signals = {
    toolModifier,
    informationalModifier,
    dedicatedToolPages,
    distinctDomains,
    toolPageShare,
    pricedDomains: input.pricedDomains,
    blockedDomains: input.blockedDomains,
    vendorIntent: input.vendorIntent ?? null,
  };

  // 没有 SERP 就没有 SERP 形态证据，词面不足以定论。
  if (distinctDomains === 0) {
    return {
      intentFit: 'INSUFFICIENT',
      score: 0.2,
      signals,
      reason: 'No organic SERP observed, so the search engine has not told us what this query is for.',
      ruleVersion: INTENT_RULE_VERSION,
    };
  }

  const nonToolKinds = input.pageKinds.filter((kind) => kind !== 'DEDICATED_TOOL').length;
  const nonToolShare = distinctDomains > 0 ? nonToolKinds / distinctDomains : 0;

  // 1. 明确的“怎么做/是什么”措辞：即使有工具页，这也是信息型查询。
  //    （"how to convert csv to excel" 有工具站排名，但用户不是在找工具目录。）
  if (informationalModifier) {
    return {
      intentFit: 'INFORMATIONAL',
      score: 0.2,
      signals,
      reason: 'Query uses explicit informational phrasing; the user is asking how/what, not shopping.',
      ruleVersion: INTENT_RULE_VERSION,
    };
  }

  // 2. 工具页构成主流形态（占比 ≥ 40% 且至少 2 个）：这才是“有产品在抢这个词”。
  if (dedicatedToolPages >= 2 && toolPageShare >= 0.4) {
    const score = Math.min(
      1,
      0.5 + toolPageShare * 0.3 + (input.pricedDomains > 0 ? 0.15 : 0) + (toolModifier ? 0.05 : 0)
    );
    return {
      intentFit: 'TOOL_INTENT',
      score: Math.round(score * 100) / 100,
      signals,
      reason: `${dedicatedToolPages} dedicated tool page(s) out of Top ${distinctDomains}${input.pricedDomains > 0 ? `, ${input.pricedDomains} charging` : ''}.`,
      ruleVersion: INTENT_RULE_VERSION,
    };
  }

  // 3. 工具修饰词 + 至少一个工具页 + 其余不占多数：也算工具意图。
  if (toolModifier && dedicatedToolPages >= 1 && nonToolShare < 0.6) {
    const score = Math.min(1, 0.45 + (input.pricedDomains > 0 ? 0.15 : 0));
    return {
      intentFit: 'TOOL_INTENT',
      score: Math.round(score * 100) / 100,
      signals,
      reason: `Tool modifier with ${dedicatedToolPages} dedicated tool page(s).`,
      ruleVersion: INTENT_RULE_VERSION,
    };
  }

  // 4. 有域名被拦截，且工具页不占主流：不知道被拦的是不是工具站，不猜。
  if (input.blockedDomains >= 2 && toolPageShare < 0.4) {
    return {
      intentFit: 'INSUFFICIENT',
      score: 0.4,
      signals,
      reason:
        `${input.blockedDomains} domain(s) could not be observed and tool pages are not the majority; ` +
        'intent cannot be judged without them.',
      ruleVersion: INTENT_RULE_VERSION,
    };
  }

  // 5. UGC / 内容 / 泛平台占多数：这是信息型 SERP。
  if (nonToolShare >= 0.6 && dedicatedToolPages <= 2) {
    return {
      intentFit: 'INFORMATIONAL',
      score: 0.2,
      signals,
      reason:
        `${dedicatedToolPages} dedicated tool page(s) out of Top ${distinctDomains}; ` +
        'the rest are UGC, content or generic platform pages. This looks like an informational query, not a product purchase.',
      ruleVersion: INTENT_RULE_VERSION,
    };
  }

  return {
    intentFit: 'INSUFFICIENT',
    score: 0.5,
    signals,
    reason:
      `Mixed SERP: ${dedicatedToolPages} dedicated tool page(s) in Top ${distinctDomains}, ` +
      `${input.blockedDomains} domain(s) could not be observed. Not enough to call the intent.`,
    ruleVersion: INTENT_RULE_VERSION,
  };
}

/**
 * 从机会的最近一次 SERP 与定价观测算出 intent_fit。
 *
 * 只读已入库数据：观测卡与每日管线用同一份判据，两边不会给出不同答案。
 */
export async function computeIntentFitForOpportunity(
  opportunityId: string,
  query: string
): Promise<IntentDecision> {
  const { query: runQuery } = await import('@emeradar/db');
  const pageKindsRes = await runQuery<{ page_kind: string | null; result_type: string | null; domain: string }>(
    `SELECT sr.page_kind, sr.result_type, sr.domain
       FROM serp_results sr
       JOIN serp_snapshots ss ON ss.id = sr.serp_snapshot_id
       JOIN opportunity_queries oq ON oq.query_id = ss.query_id AND oq.role = 'PRIMARY'
      WHERE oq.opportunity_id = $1
        AND ss.obs_date = (
          SELECT MAX(ss2.obs_date) FROM serp_snapshots ss2
           WHERE ss2.query_id = ss.query_id
        )
      ORDER BY sr.rank`,
    [opportunityId]
  );

  // 没有 page_kind（旧快照）时退回 result_type，保证历史数据也能判。
  const pageKinds = pageKindsRes.rows.map((row) => row.page_kind ?? row.result_type ?? 'UNCLASSIFIED');

  const pricingRes = await runQuery<{ domain: string; has_plans: boolean; failed: boolean }>(
    `SELECT DISTINCT ON (ct.domain)
            ct.domain,
            (jsonb_array_length(COALESCE(cs.pricing_plans, '[]'::jsonb)) > 0) AS has_plans,
            (cs.fetch_status <> 'OK') AS failed
       FROM commercial_target_opportunities cto
       JOIN commercial_targets ct ON ct.id = cto.commercial_target_id
       JOIN commercial_snapshots cs ON cs.commercial_target_id = ct.id
      WHERE cto.opportunity_id = $1
      ORDER BY ct.domain, cs.obs_date DESC`,
    [opportunityId]
  );

  const pricedDomains = pricingRes.rows.filter((row) => row.has_plans).length;
  const blockedDomains = pricingRes.rows.filter((row) => row.failed).length;

  return evaluateIntentFit({ query, pageKinds, pricedDomains, blockedDomains });
}
