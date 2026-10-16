import { AxisBand, WindowFeatures } from './types';

export interface WindowScoreResult {
  basisPoints: number; // 0 - 10000
  band: AxisBand;
  pressure: number;
  /** 不含 crowding_index 的市场 W（05 §4.2），0–10000 基点。 */
  marketBasisPoints: number;
  marketBand: AxisBand;
  reason: string;
}

/** 05 §4.2：`serp_freshness_days` 默认值。B 层每周采集一次，故为 7 天周期 + 1 天余量。 */
export const SERP_FRESHNESS_DAYS = { A: 3, B: 8 } as const;

function bandOf(basisPoints: number): AxisBand {
  if (basisPoints >= 7000) return 'HIGH';
  if (basisPoints >= 4500) return 'MEDIUM';
  return 'LOW';
}

function serpFresh(features: WindowFeatures): boolean {
  if (features.tier === 'C') return false;
  if (features.daysSinceLastSerp === undefined) return features.recentSerpSnapshotAvailable;
  const limit = features.tier === 'B' ? SERP_FRESHNESS_DAYS.B : SERP_FRESHNESS_DAYS.A;
  return features.daysSinceLastSerp <= limit;
}

export function calculateWindowScore(features: WindowFeatures): WindowScoreResult {
  const isFastTrack = Boolean(features.fastTrack) && features.serpHistoryDays >= 7;
  const minHistory = isFastTrack ? 7 : 14;

  if (features.serpHistoryDays < minHistory || !serpFresh(features)) {
    return {
      basisPoints: 0,
      band: 'INSUFFICIENT',
      pressure: 0,
      marketBasisPoints: 0,
      marketBand: 'INSUFFICIENT',
      reason: `Insufficient SERP history (minimum ${minHistory} days required) or no recent snapshot.`,
    };
  }

  const pressure = Math.min(
    100,
    30 * features.eSpecialist30d +
      40 * features.eAuthoritative30d +
      3 * features.volatility30d
  );

  const rawW =
    0.6 * features.serpWeakness +
    0.25 * (100 - pressure) +
    0.15 * (100 - features.crowdingIndex);

  const normalizedW = Math.max(0, Math.min(100, rawW));
  const basisPoints = Math.round(normalizedW * 100);

  const marketW = (0.6 * features.serpWeakness + 0.25 * (100 - pressure)) / 0.85;
  const marketBasisPoints = Math.round(Math.max(0, Math.min(100, marketW)) * 100);

  const band = bandOf(basisPoints);
  let reason = 'Competitive window is crowded or established incumbents occupy top ranks.';
  if (band === 'HIGH') {
    reason = `Open competitive window: high SERP weakness (${features.serpWeakness.toFixed(1)}%) and low incumbent pressure.`;
  } else if (band === 'MEDIUM') {
    reason = `Viable competitive window with manageable incumbent resistance.`;
  }

  return {
    basisPoints,
    band,
    pressure,
    marketBasisPoints,
    marketBand: bandOf(marketBasisPoints),
    reason,
  };
}
