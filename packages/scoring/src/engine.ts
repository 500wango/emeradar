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
import { evaluateVerdict, wDroppedWithin, WINDOW_CLOSING_FRESHNESS_DAYS } from './verdict';
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
  /** 05 §5.0 publication-gate inputs, forwarded to evaluateVerdict as-is. */
  criticalSourceFailure?: boolean;
  /**
   * Trailing 7-day observation volume over the 90-day peak window. Without it
   * the lifecycle DEAD transition is unreachable (LC-ANY-TO-DEAD).
   */
  activityRatio90d?: number;
  /** 本期观测日（`YYYY-MM-DD`）。05 §5.1 的"14 天内下降"判据以它为"今天"。 */
  obsDate?: string;
  /**
   * 拥挤透明度（`crowding_daily.verified_product_count`，05 §3.3）。
   * **不是 W 的输入**，也不进 `WindowFeatures`：只供生命周期
   * （`EARLY_WINDOW → CONTESTED`）与展示使用。缺省时不参与生命周期判定。
   */
  verifiedProductCount?: number;
}

export function calculateOpportunityScore(
  input: FullOpportunityScoreInput
): ScoringOutput {
  const isFastTrack = Boolean(input.fastTrack || input.demand.fastTrack || input.window.fastTrack);

  // 1. Demand Axis
  const dResult = calculateDemandScore({
    ...input.demand,
    fastTrack: isFastTrack,
  });

  // 2. Window Axis
  const wResult = calculateWindowScore({
    ...input.window,
    fastTrack: isFastTrack,
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
    serpHistoryDays: input.window.serpHistoryDays,
    recentSerpSnapshotAvailable: input.window.recentSerpSnapshotAvailable,
    criticalSourceFailure: input.criticalSourceFailure,
    obsDate: input.obsDate,
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
    activityRatio90d: input.activityRatio90d,
    // 拥挤透明度与 W 降档只进生命周期，不进 W（05 §3.3）。
    verifiedProductCount: input.verifiedProductCount,
    wDroppedWithinWindow: wDroppedWithin(
      input.prev?.datedWBandHistory,
      WINDOW_CLOSING_FRESHNESS_DAYS,
      input.obsDate
    ),
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
    // v3.1：拥挤度退出 W 后两者恒等；字段名保留给账本 `market_w_band`。
    marketWBand: wResult.band,
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
    topArchetypes: recoResult.topArchetypes,
  };
}
