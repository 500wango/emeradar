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
  activityRatio90d?: number; // active_7d / max_90d
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
    if (eSpecialist30d + eAuthoritative30d >= 2 || wBand === 'LOW') {
      return {
        state: 'CONTESTED',
        ruleId: 'LC-EW-TO-CONTESTED',
        reason: 'Multiple specialist or authoritative competitors entered Top 10.',
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
