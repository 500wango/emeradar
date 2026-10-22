import { AxisBand, DemandFeatures } from './types';

export interface DemandScoreResult {
  basisPoints: number; // 0 - 10000
  band: AxisBand;
  coverage: number; // 0.0 - 1.0
  reason: string;
  /**
   * 增长是否可测（审计 04）。基线不足 30 天时为 false：增长分量清零、
   * 非 fast-track 路径封顶 MEDIUM，理由声明「仅新发现」。调用方未传
   * `growthBaselineDays` 时视为可测（历史调用方兼容）。
   */
  growthMeasurable: boolean;
}

/** 可比时间序列的最短长度（审计 04：没有基线不得宣称增长）。 */
export const GROWTH_BASELINE_MIN_DAYS = 30;

export function calculateDemandScore(
  features: DemandFeatures,
  percentiles?: {
    newQueries?: number; // 0 - 100
    growth?: number;
    expansion?: number;
    attention?: number;
    trends?: number;
  }
): DemandScoreResult {
  const isFastTrack = Boolean(features.fastTrack) && features.historyDays >= 7;

  // If baseline period / insufficient history
  if (features.historyDays < 14 && !isFastTrack) {
    return {
      basisPoints: 0,
      band: 'INSUFFICIENT',
      coverage: 0,
      reason: `History of ${features.historyDays} days is below baseline threshold (14 days).`,
      growthMeasurable: false,
    };
  }

  // 审计 04：newQueries7d 记录的是「观察窗口内第一次被采到」，采集加深、补齐旧词
  // 或供应商波动都会推高它。评分只吃持久新词（近 7 天 ≥2 个观测日重复出现）；
  // 未提供持久口径时退回原值，保持历史调用方兼容。
  const effectiveNewQueries = features.newQueriesPersistent7d ?? features.newQueries7d;

  // 审计 04：可比基线不足时不得宣称增长。调用方显式传入基线天数才启用该门槛。
  const growthMeasurable =
    features.growthBaselineDays === undefined ||
    features.growthBaselineDays >= GROWTH_BASELINE_MIN_DAYS;

  // Every percentile input is clamped to 0-100 before weighting. Callers may
  // supply pre-computed percentiles, and the heuristic fallbacks are unbounded
  // expressions over raw feature counts — without this clamp a single noisy
  // feature (e.g. 10 active attention sources) drives the score past 10000.
  const clampPct = (value: number | undefined, fallback: number): number =>
    Math.min(100, Math.max(0, Number.isFinite(value as number) ? (value as number) : fallback));

  const pctNewQueries = clampPct(percentiles?.newQueries, Math.min(100, effectiveNewQueries * 15));
  const pctGrowth = growthMeasurable
    ? clampPct(percentiles?.growth, Math.min(100, Math.max(0, (features.clusterGrowth30d + 0.2) * 50)))
    : 0;
  const pctExpansion = growthMeasurable
    ? clampPct(percentiles?.expansion, Math.min(100, Math.max(0, features.expansionSlope30d * 100)))
    : 0;
  const pctAttention = clampPct(
    percentiles?.attention,
    Math.min(100, features.attentionSourcesActive14d * 25 + features.attentionGrowth14d * 20)
  );

  let weightedSum = 0;
  let totalWeights = 0;

  // new_queries_7d: 0.30
  weightedSum += 0.3 * pctNewQueries;
  totalWeights += 0.3;

  // cluster_growth_30d: 0.25
  weightedSum += 0.25 * pctGrowth;
  totalWeights += 0.25;

  // expansion_slope_30d: 0.20
  weightedSum += 0.2 * pctExpansion;
  totalWeights += 0.2;

  // attention: 0.15
  weightedSum += 0.15 * pctAttention;
  totalWeights += 0.15;

  // trends_slope_90d: 0.10 (optional)
  if (features.trendsSlope90d !== undefined) {
    const pctTrends = clampPct(percentiles?.trends, Math.min(100, Math.max(0, (features.trendsSlope90d + 1) * 50)));
    weightedSum += 0.1 * pctTrends;
    totalWeights += 0.1;
  }

  const coverage = Math.round((totalWeights / 1.0) * 100) / 100;
  if (coverage < 0.6) {
    return {
      basisPoints: 0,
      band: 'INSUFFICIENT',
      coverage,
      reason: `Feature coverage (${Math.round(coverage * 100)}%) is below 60%.`,
      growthMeasurable,
    };
  }

  const normalizedScore = weightedSum / totalWeights;
  // The banding below assumes a 0-10000 basis-point scale; clamp so no input can
  // produce an out-of-range score that downstream banding would read as HIGH.
  const basisPoints = Math.min(10000, Math.max(0, Math.round(normalizedScore * 100)));

  let band: AxisBand = 'LOW';
  let reason = 'Demand signals are currently low.';

  if (basisPoints >= 7500 && effectiveNewQueries >= 3 && features.clusterSize >= 8) {
    band = 'HIGH';
    reason = isFastTrack
      ? `[FAST-TRACK] Strong demand velocity: ${effectiveNewQueries} persistent new queries in 7d, cluster size ${features.clusterSize}.`
      : `Strong demand velocity: ${effectiveNewQueries} persistent new queries in 7d, cluster size ${features.clusterSize}.`;
  } else if (basisPoints >= 5000 && features.clusterSize >= 5) {
    band = 'MEDIUM';
    reason = isFastTrack
      ? `[FAST-TRACK] Moderate demand growth across ${features.clusterSize} clustered queries.`
      : `Moderate demand growth across ${features.clusterSize} clustered queries.`;
  }

  // 审计 04：没有可比基线时，HIGH 不成立——那只是「新发现」，不是「在增长」。
  // fast-track 是显式标记的产品例外（自带 FAST_TRACK 标志），不受此封顶。
  // 无论落哪个档，理由都必须声明「仅新发现」，避免展示层把 LOW 读成增长结论。
  if (band === 'HIGH' && !growthMeasurable && !isFastTrack) {
    band = 'MEDIUM';
  }
  if (!growthMeasurable) {
    reason = `${reason} Growth not yet measurable (baseline ${features.growthBaselineDays}d < ${GROWTH_BASELINE_MIN_DAYS}d): new-discovery signals only.`;
  }

  return {
    basisPoints,
    band,
    coverage,
    reason,
    growthMeasurable,
  };
}
