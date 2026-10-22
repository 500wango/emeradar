import {
  Verdict,
  Lifecycle,
  Confidence,
  Band,
  BuildArchetype,
  ExecutionClass,
  CommercialStage,
} from '@emeradar/core';
// 只引类型：`recommendation.ts` 反向引本文件的 `AxisBand` / `CommercialSummary`，
// 用 `import type` 让两个方向都在编译后消失，不产生运行时环。
import type { ArchetypeScore } from './recommendation';

export type AxisBand = Band;

export type ResultType =
  | 'SPECIALIST'
  /** 泛平台落地页（wix/squarespace）：占位，但不是同类竞品。 */
  | 'GENERIC_PLATFORM'
  /** 托管/基础设施服务商：同上。 */
  | 'HOSTING_SERVICE'
  | 'OFFICIAL'
  | 'EDITORIAL_MEDIA'
  | 'LISTICLE_AFFILIATE'
  | 'DIRECTORY'
  | 'VIDEO'
  | 'DOC'
  | 'UGC_THREAD'
  | 'QA'
  | 'THIN_PAGE'
  | 'OFF_TOPIC'
  | 'UNCLASSIFIED';

export interface SerpItemInput {
  rank: number; // 1 - 20
  url: string;
  domain: string;
  title: string;
  snippet?: string;
  resultType: ResultType;
  ageDays?: number;
  relevance?: number; // 0.0 - 1.0
  isHomepage?: boolean;
  isDedicatedLandingPage?: boolean;
  domainDr?: number;
}

export interface SerpItemWeaknessOutput {
  rank: number;
  url: string;
  domain: string;
  title: string;
  resultType: ResultType;
  baseWeakness: number;
  ageAdj: number;
  relevanceAdj: number;
  pageDiscount: number; // 0.45 for inner page, 0.65 for dedicated, 1.0 for homepage
  totalWeakness: number; // 0.0 - 1.0
  /** totalWeakness × pageDiscount：进入加总的口径（审计 05）。 */
  discountedWeakness: number; // 0.0 - 1.0
  isWeak: boolean;
  weaknessType?: string;
  isHomepage: boolean;
  domainDr?: number;
}

export interface SerpWeaknessResult {
  score: number; // 0 - 100
  items: SerpItemWeaknessOutput[];
  weakCount: number;
  weakSitesCount: number; // sites with DR < 25 or ageDays < 540
  innerPagesCount: number;
  homepageCount: number;
  structuralPenetrationReasons: string[];
  penetrationAngle: 'HOMEPAGE_DIRECT' | 'ALTERNATIVE_INTERCEPT' | 'AGGREGATOR_PAGE' | 'LONGTAIL_CLUSTER';
}

export interface DemandFeatures {
  clusterSize: number;
  newQueries7d: number;
  clusterGrowth30d: number; // e.g. 0.5 for +50%
  expansionSlope30d: number;
  attentionSourcesActive14d: number; // 0 - 4
  attentionGrowth14d: number;
  trendsSlope90d?: number;
  historyDays: number;
  fastTrack?: boolean;
}

export interface WindowFeatures {
  serpWeakness: number; // 0 - 100
  eSpecialist30d: number;
  eAuthoritative30d: number;
  volatility30d: number;
  serpHistoryDays: number;
  recentSerpSnapshotAvailable: boolean;
  /** 追踪层级（05 §4.2 的 `serp_freshness_days[tier]`）。缺省按 A 层处理。 */
  tier?: 'A' | 'B' | 'C';
  /** 距最近一份 SERP 快照的天数；缺省时退回 `recentSerpSnapshotAvailable`。 */
  daysSinceLastSerp?: number;
  fastTrack?: boolean;
}

export interface CommercialNegativeSignal {
  type: string;
  domains: number;
  strong: boolean;
}

/**
 * M-axis input contract (07-COMMERCIAL-SIGNAL-SPEC §5).
 * Assembly fills the raw counts; bandM() derives band/score/stage/negatives.
 * Fields beyond independentDomainsCount/band are optional so hand-built
 * summaries (tests, legacy callers) still type-check.
 */
export interface CommercialSummary {
  independentDomainsCount: number;
  hasSubscriptionPlans: boolean;
  hasOneTimePlans: boolean;
  hasStrongNegative: boolean;
  negativeReasons?: string[];
  totalScore: number; // for ranking
  band: AxisBand;
  hasTransactionTraction?: boolean;
  pricingDecorationOnly?: boolean;
  persistentPricedDomains?: number;
  /** See CommercialBandResult.inferredOnly (07 §5 / 05 §5.0). */
  inferredOnly?: boolean;

  asOf?: string;
  sampledDomains?: number;
  sampleCoverage?: number;
  independentPricedDomains?: number;
  categoryOrAnalogPricedDomains?: number;
  intentQueryCount?: number;
  infraOnlyDomains?: number;
  revenueEvidence?: { observed: number; selfReported: number };
  negatives?: CommercialNegativeSignal[];
  contradictions?: number;
  evidenceIds?: string[];
  stage?: CommercialStage;
  maxSnapshotSpanDays?: number;
  persistenceDaysNeeded?: number;
  bandReason?: string;
}

export interface EvidenceConfidenceInput {
  nIndependentSources: number;
  totalEvidenceCount: number;
  observedEvidenceCount: number;
  medianEvidenceAgeDays: number;
  historyDays: number;
}

/** 逐日 W 档位及其观测日期（`YYYY-MM-DD`）。 */
export interface DatedWBand {
  obsDate: string;
  band: AxisBand;
}

export interface PrevScoringState {
  verdict: Verdict;
  rawVerdict: Verdict;
  lifecycle: Lifecycle;
  daysInCurrentVerdict: number;
  daysInCurrentLifecycle: number;
  wBandHistory: AxisBand[]; // recent W bands
  /**
   * 带日期的 W 档位序列，旧→新（05 §5.1 必要条件 2）。
   *
   * 缺了日期，"W 是否在 14 天内下降"就退化成"最后一格比第一格低"——而第一格
   * 可能是任意久远的读数，于是一次半年前的降档会在今天触发 WINDOW_CLOSING，
   * 把仍有价值的窗口提前判成关闭（连带影响免费层公开投影与告警）。
   *
   * 可选：仅为不采集逐日历史的老调用方保留退回路径。
   */
  datedWBandHistory?: DatedWBand[];
}

export interface ScoringOutput {
  verdict: Verdict;
  rawVerdict: Verdict;
  lifecycle: Lifecycle;
  confidence: Confidence;
  confidenceScore: number; // 0.0 - 1.0
  dScore: number; // 0 - 10000 basis points
  mScore: number; // 0 - 10000 basis points
  wScore: number; // 0 - 10000 basis points
  dBand: AxisBand;
  mBand: AxisBand;
  wBand: AxisBand;
  /**
   * 窗口档位（05 §4.2）。拥挤度已退出 W（v3.1），本字段与 `wBand` 恒等；
   * 保留列名是因为账本 `market_w_band` 与历史快照按此名读取。
   */
  marketWBand?: AxisBand;
  flags: string[];
  explanation: {
    dReason: string;
    mReason: string;
    wReason: string;
    verdictReason: string;
    rulesTriggered: string[];
  };
  recommendedArchetype: BuildArchetype;
  executionClass: ExecutionClass;
  /**
   * 推荐层排出的前三名构建形态（05 §11、`evaluateRecommendations`）。
   *
   * 「这条机会提供哪几个形态的队」必须来自同一个推荐结论，不能由别处再猜一遍：
   * `recommended_archetype` 只够建一条队，多形态的用意（工具站先行、Micro-SaaS
   * 仍空着）就落不了地。这里把它带出来，供报告与展示说明构建顺序。
   *
   * v3.1 起它不再用于物化槽位：槽位、容量上限与认领都已从产品中删除。
   */
  topArchetypes: ArchetypeScore[];
}
