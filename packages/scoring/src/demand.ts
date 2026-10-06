import { AxisBand, DemandFeatures } from './types';

export interface DemandScoreResult {
  basisPoints: number; // 0 - 10000
  band: AxisBand;
  coverage: number; // 0.0 - 1.0
  reason: string;
}

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
    };
  }

  // Fallback to normalized heuristic if universe percentiles are not provided
  const pctNewQueries = percentiles?.newQueries ?? Math.min(100, features.newQueries7d * 15);
  const pctGrowth =
    percentiles?.growth ??
    Math.min(100, Math.max(0, (features.clusterGrowth30d + 0.2) * 50));
  const pctExpansion =
    percentiles?.expansion ??
    Math.min(100, Math.max(0, features.expansionSlope30d * 100));
  const pctAttention =
    percentiles?.attention ??
    Math.min(100, features.attentionSourcesActive14d * 25 + features.attentionGrowth14d * 20);

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
    const pctTrends =
      percentiles?.trends ?? Math.min(100, Math.max(0, (features.trendsSlope90d + 1) * 50));
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
    };
  }

  const normalizedScore = weightedSum / totalWeights;
  const basisPoints = Math.round(normalizedScore * 100); // 0 - 10000

  let band: AxisBand = 'LOW';
  let reason = 'Demand signals are currently low.';

  if (basisPoints >= 7500 && features.newQueries7d >= 3 && features.clusterSize >= 8) {
    band = 'HIGH';
    reason = isFastTrack
      ? `[FAST-TRACK] Strong demand velocity: ${features.newQueries7d} new queries in 7d, cluster size ${features.clusterSize}.`
      : `Strong demand velocity: ${features.newQueries7d} new queries in 7d, cluster size ${features.clusterSize}.`;
  } else if (basisPoints >= 5000 && features.clusterSize >= 5) {
    band = 'MEDIUM';
    reason = isFastTrack
      ? `[FAST-TRACK] Moderate demand growth across ${features.clusterSize} clustered queries.`
      : `Moderate demand growth across ${features.clusterSize} clustered queries.`;
  }

  return {
    basisPoints,
    band,
    coverage,
    reason,
  };
}
