import { Lifecycle } from '@emeradar/core';
import { AxisBand, PrevScoringState } from './types';

export interface LifecycleInput {
  dBand: AxisBand;
  wBand: AxisBand;
  eSpecialist30d: number;
  eAuthoritative30d: number;
  volatility30d: number;
  expansionSlope30d: number;
  newQueries7d: number;
  /** Trailing 7-day observation volume divided by the 90-day peak 7-day window. */
  activityRatio90d?: number; // active_7d / max_90d
  /**
   * 拥挤透明度（`crowding_daily.verified_product_count`，05 §3.3）。
   * **只进生命周期，不进 W**：达到 3 个已验证产品即视为窗口进入竞争态。
   */
  verifiedProductCount?: number;
  /** W 较 14 天前降过 ≥1 档（05 §5.1）。**只进生命周期，不进 W**。 */
  wDroppedWithinWindow?: boolean;
  prev?: PrevScoringState;
}

export interface LifecycleResult {
  state: Lifecycle;
  ruleId: string;
  reason: string;
}

export function evaluateLifecycle(input: LifecycleInput): LifecycleResult {
  const {
    dBand,
    wBand,
    eSpecialist30d,
    eAuthoritative30d,
    volatility30d,
    expansionSlope30d,
    newQueries7d,
    activityRatio90d,
    verifiedProductCount,
    wDroppedWithinWindow,
    prev,
  } = input;

  const currentState = prev?.lifecycle ?? 'FORMING';
  const dGeMedium = dBand === 'HIGH' || dBand === 'MEDIUM';
  const wGeMedium = wBand === 'HIGH' || wBand === 'MEDIUM';

  // Check DEAD transition
  if (activityRatio90d !== undefined && activityRatio90d <= 0.6) {
    if (prev?.daysInCurrentLifecycle && prev.daysInCurrentLifecycle >= 60) {
      return {
        state: 'DEAD',
        ruleId: 'LC-ANY-TO-DEAD',
        reason: 'Demand activity collapsed below 60% of 90-day peak for over 60 days.',
      };
    }
  }

  // If currently DEAD, check resuscitation
  if (currentState === 'DEAD') {
    if (dGeMedium && newQueries7d >= 5) {
      return {
        state: 'FORMING',
        ruleId: 'LC-DEAD-TO-FORMING',
        reason: 'Resurgence in demand observed: new query generation with D >= MEDIUM.',
      };
    }
    return {
      state: 'DEAD',
      ruleId: 'LC-HOLD-DEAD',
      reason: 'Opportunity remains inactive.',
    };
  }

  // Transitions from FORMING
  if (currentState === 'FORMING') {
    if (wBand === 'LOW' && eSpecialist30d >= 2) {
      return {
        state: 'CONTESTED',
        ruleId: 'LC-FORMING-TO-CONTESTED',
        reason: 'Incumbents quickly seized the emerging search space.',
      };
    }
    if (dGeMedium && wGeMedium) {
      return {
        state: 'EARLY_WINDOW',
        ruleId: 'LC-FORMING-TO-EARLY-WINDOW',
        reason: 'Demand confirmed and window is open with weak incumbent presence.',
      };
    }
    return {
      state: 'FORMING',
      ruleId: 'LC-HOLD-FORMING',
      reason: 'Search demand and SERP patterns still coalescing.',
    };
  }

  // Transitions from EARLY_WINDOW
  if (currentState === 'EARLY_WINDOW') {
    // v3.1（05 §3.3）：竞争态不只由"强站进入 Top10"判定。窗口档位在 14 天内降过，
    // 或已验证产品数达到 3，都说明这条机会已经不再是无人区。两者只回答"窗口是否
    // 仍然独占"，不参与 W 的计算。
    if (
      eSpecialist30d + eAuthoritative30d >= 2 ||
      wBand === 'LOW' ||
      wDroppedWithinWindow === true ||
      (verifiedProductCount ?? 0) >= 3
    ) {
      return {
        state: 'CONTESTED',
        ruleId: 'LC-EW-TO-CONTESTED',
        reason:
          'Window closed: specialists entered Top 10, the W band dropped within 14 days, or 3+ verified products now occupy the query.',
      };
    }
    return {
      state: 'EARLY_WINDOW',
      ruleId: 'LC-HOLD-EARLY-WINDOW',
      reason: 'Prime window remains open for new entrants.',
    };
  }

  // Transitions from CONTESTED
  if (currentState === 'CONTESTED') {
    if (wBand === 'HIGH' && eSpecialist30d === 0 && eAuthoritative30d === 0) {
      return {
        state: 'EARLY_WINDOW',
        ruleId: 'LC-CONTESTED-TO-EARLY-WINDOW',
        reason: 'Competitive pressure decreased and SERP weakness reopened.',
      };
    }
    if (
      volatility30d <= 1.5 &&
      eSpecialist30d === 0 &&
      expansionSlope30d <= 0.02 &&
      (prev?.daysInCurrentLifecycle ?? 0) >= 60
    ) {
      return {
        state: 'MATURE',
        ruleId: 'LC-CONTESTED-TO-MATURE',
        reason: 'SERP ranking hierarchy has stabilized with established market leaders.',
      };
    }
    return {
      state: 'CONTESTED',
      ruleId: 'LC-HOLD-CONTESTED',
      reason: 'Active competition among market players.',
    };
  }

  // Transitions from MATURE
  return {
    state: 'MATURE',
    ruleId: 'LC-HOLD-MATURE',
    reason: 'Established market with saturated SERP.',
  };
}
