import { AxisBand, WindowFeatures } from './types';

export interface WindowScoreResult {
  basisPoints: number; // 0 - 10000
  band: AxisBand;
  pressure: number;
  reason: string;
}

export function calculateWindowScore(features: WindowFeatures): WindowScoreResult {
  if (features.serpHistoryDays < 14 || !features.recentSerpSnapshotAvailable) {
    return {
      basisPoints: 0,
      band: 'INSUFFICIENT',
      pressure: 0,
      reason: 'Insufficient SERP history (minimum 14 days required) or no recent snapshot.',
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

  let band: AxisBand = 'LOW';
  let reason = 'Competitive window is crowded or established incumbents occupy top ranks.';

  if (basisPoints >= 7000) {
    band = 'HIGH';
    reason = `Open competitive window: high SERP weakness (${features.serpWeakness.toFixed(1)}%) and low incumbent pressure.`;
  } else if (basisPoints >= 4500) {
    band = 'MEDIUM';
    reason = `Viable competitive window with manageable incumbent resistance.`;
  }

  return {
    basisPoints,
    band,
    pressure,
    reason,
  };
}
