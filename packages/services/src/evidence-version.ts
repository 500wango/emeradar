/**
 * 证据提取器版本（Phase 0）。
 *
 * 同一份原始载荷在不同解析规则下会得出不同的证据——价格正则、SERP 弱点分类、
 * Autocomplete 过滤都改过多次。不记录版本，历史 `evidence` 行就无法回答
 * "这条结论是哪一版规则算出来的"，也就谈不上重算。
 *
 * 规则改动时**必须**升版本，并在回测里按版本分组，避免新旧口径混算。
 */
export const EXTRACTOR_VERSIONS = {
  /** Google Autocomplete（AIsa/DataForSEO）：suggestions 直取，无解析歧义。 */
  AUTOCOMPLETE: 'ac-1.0.0',
  /** SERP：rank_group 取序、Top10 评分集、弱点分类。 */
  SERP: 'serp-1.1.0',
  /** 商业抓取：JSON-LD/meta/可见文本三级解析，convert/currency 归一。 */
  COMMERCIAL: 'crawl-1.2.0',
  /** 商业快照差异（价格变动、网关消失）。 */
  COMMERCIAL_DIFF: 'crawl-diff-1.0.0',
  /** 实时初筛（/scan）：autocomplete + SERP 即时探测。 */
  LIVE_SCAN: 'scan-1.0.0',
  /** Google Trends 公开 RSS。 */
  GOOGLE_TRENDS: 'trends-1.0.0',
} as const;

export type ExtractorVersionKey = keyof typeof EXTRACTOR_VERSIONS;

/**
 * 特征快照版本（写入 `opportunity_snapshots.metrics` 的那一组派生数值）。
 * 阈值变了、指标定义变了都要升版本：同一列 `history_days` 在不同版本下不是同一个量。
 */
export const FEATURE_VERSION = 'features-1.0.0';

/**
 * 规则引擎版本（flags / 分档 / 去抖规则）。与 `scoring_config_version` 分开：
 * 后者是配置数值，前者是判定逻辑本身。
 */
export const RULE_ENGINE_VERSION = 'rules-1.0.0';

/** 按 `evidence.source_type` 推导提取器版本；未知类型返回 null，不猜。 */
export function extractorVersionForSourceType(sourceType: string): string | null {
  switch (sourceType) {
    case 'AUTOCOMPLETE':
      return EXTRACTOR_VERSIONS.AUTOCOMPLETE;
    case 'SERP':
      return EXTRACTOR_VERSIONS.SERP;
    case 'PAID_TIER_OBSERVED':
    case 'PAYMENT_INFRA_DETECTED':
    case 'COMMERCIAL_CRAWL':
      return EXTRACTOR_VERSIONS.COMMERCIAL;
    case 'PRICE_CHANGE_MAJOR':
    case 'PRICING_REMOVED':
      return EXTRACTOR_VERSIONS.COMMERCIAL_DIFF;
    case 'GOOGLE_TRENDS':
      return EXTRACTOR_VERSIONS.GOOGLE_TRENDS;
    default:
      return null;
  }
}
