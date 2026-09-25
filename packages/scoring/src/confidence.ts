import { Confidence } from '@emeradar/core';
import { EvidenceConfidenceInput } from './types';

export interface ConfidenceResult {
  score: number; // 0.0 - 1.0
  level: Confidence;
  freshness: number;
  observedShare: number;
}

export function calculateConfidence(input: EvidenceConfidenceInput): ConfidenceResult {
  const sourcesPart = 0.35 * Math.min(1.0, input.nIndependentSources / 4.0);

  const observedShare =
    input.totalEvidenceCount > 0
      ? input.observedEvidenceCount / input.totalEvidenceCount
      : 0;
  const observedPart = 0.25 * observedShare;

  const freshness = Math.max(
    0.0,
    Math.min(1.0, 1.0 - input.medianEvidenceAgeDays / 90.0)
  );
  const freshnessPart = 0.2 * freshness;

  const historyPart = 0.2 * Math.min(1.0, input.historyDays / 60.0);

  const rawScore = sourcesPart + observedPart + freshnessPart + historyPart;
  const score = Math.round(rawScore * 1000) / 1000;

  let level: Confidence = 'LOW';
  if (score >= 0.75) {
    level = 'HIGH';
  } else if (score >= 0.5) {
    level = 'MEDIUM';
  }

  return {
    score,
    level,
    freshness,
    observedShare,
  };
}
