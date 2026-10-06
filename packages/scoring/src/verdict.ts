import { Verdict, Confidence } from '@emeradar/core';
import { AxisBand, CommercialSummary, PrevScoringState } from './types';

export interface VerdictInput {
  dBand: AxisBand;
  mSummary: CommercialSummary;
  wBand: AxisBand;
  confidence: Confidence;
  prev?: PrevScoringState;
  historyDays: number;
  fastTrack?: boolean;
  claimsCount?: number;
  maxClaims?: number;
  isCrowdedLocked?: boolean;
}

export interface VerdictResult {
  verdict: Verdict;
  rawVerdict: Verdict;
  flags: string[];
  reason: string;
  rulesTriggered: string[];
}

export function evaluateVerdict(input: VerdictInput): VerdictResult {
  const { dBand, mSummary, wBand, confidence, prev, historyDays } = input;
  const negativeM = mSummary.hasStrongNegative;
  const rulesTriggered: string[] = [];
  const flags: string[] = [];

  const isFastTrack = Boolean(input.fastTrack) || (historyDays >= 7 && historyDays < 14 && dBand !== 'INSUFFICIENT');
  const isCrowdedLocked =
    Boolean(input.isCrowdedLocked) ||
    (input.claimsCount !== undefined &&
      input.maxClaims !== undefined &&
      input.claimsCount >= input.maxClaims);

  // Flag detection
  if (negativeM) {
    flags.push('M_NEGATIVE');
  }
  if (isCrowdedLocked) {
    flags.push('CROWDED_LOCKED');
  }
  if (isFastTrack) {
    flags.push('FAST_TRACK');
  }
  if (confidence === 'LOW') {
    flags.push('LOW_CONFIDENCE');
  }
  if (dBand === 'INSUFFICIENT' || wBand === 'INSUFFICIENT' || mSummary.band === 'INSUFFICIENT') {
    flags.push('PARTIAL_DATA');
  }
  if (historyDays < 14 && !isFastTrack) {
    flags.push('BASELINE_PERIOD');
  }

  // Check if W dropped in recent history
  let wDroppedRecently = false;
  if (prev?.wBandHistory && prev.wBandHistory.length >= 2) {
    const recent = prev.wBandHistory[prev.wBandHistory.length - 1];
    const past = prev.wBandHistory[0];
    if (
      (past === 'HIGH' && (recent === 'MEDIUM' || recent === 'LOW')) ||
      (past === 'MEDIUM' && recent === 'LOW')
    ) {
      wDroppedRecently = true;
      if (prev.verdict === 'BUILD_NOW' || prev.verdict === 'EARLY_BET') {
        flags.push('W_DROPPING');
      }
    }
  }

  // 1. Calculate raw verdict
  let raw: Verdict = 'WATCH';
  let reason = '';

  const dGeMedium = dBand === 'HIGH' || dBand === 'MEDIUM';
  const wGeMedium = wBand === 'HIGH' || wBand === 'MEDIUM';
  const confGeMedium = confidence === 'HIGH' || confidence === 'MEDIUM';

  if (isCrowdedLocked) {
    raw = 'WINDOW_CLOSING';
    rulesTriggered.push('RULE_CROWDED_LOCKED');
    reason =
      'Opportunity reached maximum builder claim capacity (slots full); window closing to public feed to prevent crowding alpha decay.';
  } else {
    const mVerifiedStandard =
      (!mSummary.pricingDecorationOnly && mSummary.band === 'HIGH') ||
      (mSummary.band === 'HIGH' && Boolean(mSummary.hasTransactionTraction)) ||
      (mSummary.band === 'MEDIUM' &&
        mSummary.independentDomainsCount >= 2 &&
        mSummary.hasSubscriptionPlans);

    const mCompensatedVerified =
      mVerifiedStandard ||
      mSummary.band === 'HIGH' ||
      (mSummary.band === 'MEDIUM' &&
        (mSummary.independentDomainsCount >= 2 || Boolean(mSummary.hasTransactionTraction)));

    const isEarlyBet =
      (dBand === 'HIGH' && wGeMedium) ||
      (isFastTrack && dGeMedium && wBand === 'HIGH');

    if (dGeMedium && mVerifiedStandard && wGeMedium && confGeMedium && !negativeM) {
      raw = 'BUILD_NOW';
      rulesTriggered.push('RULE_BUILD_NOW');
      reason =
        'All signals aligned: verified commercial monetization, high/medium demand, open window, and strong evidence.';
    } else if (dBand === 'HIGH' && wBand === 'HIGH' && mCompensatedVerified && confGeMedium && !negativeM) {
      raw = 'BUILD_NOW';
      rulesTriggered.push('RULE_BUILD_NOW_COMPENSATED');
      reason =
        'Feature-compensated build: breakout demand and open competitive window compensate for developing commercial proof.';
    } else if (
      isEarlyBet &&
      (mSummary.band === 'LOW' || mSummary.band === 'MEDIUM' || mSummary.band === 'INSUFFICIENT') &&
      !negativeM
    ) {
      raw = 'EARLY_BET';
      rulesTriggered.push('RULE_EARLY_BET');
      reason =
        'High demand or fast-track momentum with open competitive window and unverified commercial signal. Early builder opportunity.';
    } else if (
      (prev &&
        (prev.verdict === 'BUILD_NOW' || prev.verdict === 'EARLY_BET') &&
        wDroppedRecently) ||
      (prev &&
        prev.verdict === 'WINDOW_CLOSING' &&
        wBand !== 'HIGH' &&
        dGeMedium &&
        prev.daysInCurrentVerdict <= 30)
    ) {
      raw = 'WINDOW_CLOSING';
      rulesTriggered.push('RULE_WINDOW_CLOSING');
      reason =
        'Incumbents entering SERP or window closing. Immediate action or pivot required.';
    } else if (dBand === 'LOW' || negativeM || wBand === 'LOW') {
      raw = 'PASS';
      rulesTriggered.push('RULE_PASS');
      reason = negativeM
        ? 'Strong negative commercial evidence observed.'
        : dBand === 'LOW'
        ? 'Demand volume or momentum is too low.'
        : 'Competitive window is closed by incumbents.';
    } else {
      raw = 'WATCH';
      rulesTriggered.push('RULE_WATCH');
      reason = 'Signals are emerging or data is accumulating. Keep on radar.';
    }
  }

  // 2. Debounce logic
  let published: Verdict = raw;

  if (negativeM) {
    // Bypass debounce on strong negative signal
    published = 'PASS';
    rulesTriggered.push('DEBOUNCE_BYPASS_NEGATIVE_M');
  } else if (isCrowdedLocked) {
    // Bypass debounce on claim slot exhaustion
    published = 'WINDOW_CLOSING';
    rulesTriggered.push('DEBOUNCE_BYPASS_CROWDED_LOCKED');
  } else if (prev) {
    // Check upgrade debounce (need 2 consecutive days)
    if ((raw === 'BUILD_NOW' || raw === 'EARLY_BET') && prev.verdict !== raw) {
      if (prev.rawVerdict === raw && prev.daysInCurrentVerdict >= 2) {
        published = raw;
        rulesTriggered.push('DEBOUNCE_UPGRADE_CONFIRMED');
      } else {
        published = prev.verdict; // Keep previous published until confirmed
        rulesTriggered.push('DEBOUNCE_UPGRADE_PENDING');
      }
    } else if (
      (prev.verdict === 'BUILD_NOW' || prev.verdict === 'EARLY_BET') &&
      raw !== prev.verdict
    ) {
      // Downgrade debounce (need 2 consecutive days)
      if (prev.rawVerdict === raw && prev.daysInCurrentVerdict >= 2) {
        published = raw;
        rulesTriggered.push('DEBOUNCE_DOWNGRADE_CONFIRMED');
      } else {
        published = prev.verdict;
        rulesTriggered.push('DEBOUNCE_DOWNGRADE_PENDING');
      }
    } else {
      published = raw;
    }
  }

  return {
    verdict: published,
    rawVerdict: raw,
    flags,
    reason,
    rulesTriggered,
  };
}
