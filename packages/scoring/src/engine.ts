import {
  DemandFeatures,
  WindowFeatures,
  CommercialSummary,
  EvidenceConfidenceInput,
  PrevScoringState,
  ScoringOutput,
} from './types';
import { calculateDemandScore } from './demand';
import { calculateWindowScore } from './window';
import { calculateConfidence } from './confidence';
import { evaluateVerdict } from './verdict';
import { evaluateLifecycle } from './lifecycle';
import { evaluateRecommendations, RecommendationInput } from './recommendation';

export interface FullOpportunityScoreInput {
  demand: DemandFeatures;
  window: WindowFeatures;
  commercial: CommercialSummary;
  confidence: EvidenceConfidenceInput;
  recommendation: RecommendationInput;
  prev?: PrevScoringState;
  fastTrack?: boolean;
  claimsCount?: number;
  maxClaims?: number;
  isCrowdedLocked?: boolean;
}

export function calculateOpportunityScore(
  input: FullOpportunityScoreInput
): ScoringOutput {
  const isFastTrack = Boolean(input.fastTrack || input.demand.fastTrack || input.window.fastTrack);
  const isCrowdedLocked = Boolean(input.isCrowdedLocked || input.window.isCrowdedLocked);
  const claimsCount = input.claimsCount ?? input.window.claimsCount;
  const maxClaims = input.maxClaims ?? input.window.maxClaims;

  // 1. Demand Axis
  const dResult = calculateDemandScore({
    ...input.demand,
    fastTrack: isFastTrack,
  });

  // 2. Window Axis
  const wResult = calculateWindowScore({
    ...input.window,
    fastTrack: isFastTrack,
    claimsCount,
    maxClaims,
    isCrowdedLocked,
  });

  // 3. Evidence Confidence
  const confResult = calculateConfidence(input.confidence);

  // 4. Commercial M-Score (basis points from commercial summary)
  const mScore = input.commercial.totalScore;
  const mBand = input.commercial.band;

  // 5. Verdict Evaluation
  const verdictResult = evaluateVerdict({
    dBand: dResult.band,
    mSummary: input.commercial,
    wBand: wResult.band,
    confidence: confResult.level,
    prev: input.prev,
    historyDays: input.demand.historyDays,
    fastTrack: isFastTrack,
    claimsCount,
    maxClaims,
    isCrowdedLocked,
  });

  // 6. Lifecycle Evaluation
  const lifecycleResult = evaluateLifecycle({
    dBand: dResult.band,
    wBand: wResult.band,
    eSpecialist30d: input.window.eSpecialist30d,
    eAuthoritative30d: input.window.eAuthoritative30d,
    volatility30d: input.window.volatility30d,
    expansionSlope30d: input.demand.expansionSlope30d,
    newQueries7d: input.demand.newQueries7d,
    prev: input.prev,
  });

  // 7. Recommendations
  const recoResult = evaluateRecommendations(input.recommendation);

  return {
    verdict: verdictResult.verdict,
    rawVerdict: verdictResult.rawVerdict,
    lifecycle: lifecycleResult.state,
    confidence: confResult.level,
    confidenceScore: confResult.score,
    dScore: dResult.basisPoints,
    mScore,
    wScore: wResult.basisPoints,
    dBand: dResult.band,
    mBand,
    wBand: wResult.band,
    flags: verdictResult.flags,
    explanation: {
      dReason: dResult.reason,
      mReason: input.commercial.negativeReasons?.length
        ? input.commercial.negativeReasons.join('; ')
        : input.commercial.bandReason || 'Active commercial validation signals.',
      wReason: wResult.reason,
      verdictReason: verdictResult.reason,
      rulesTriggered: verdictResult.rulesTriggered,
    },
    recommendedArchetype: recoResult.recommendedArchetype,
    executionClass: recoResult.recommendedExecutionClass,
  };
}
