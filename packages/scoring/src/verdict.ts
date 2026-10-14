import { Verdict, Confidence } from '@emeradar/core';
import { AxisBand, CommercialSummary, DatedWBand, PrevScoringState } from './types';

/**
 * W 轴的档位高低序。`INSUFFICIENT` 刻意不在其中——见 `wDroppedWithin`。
 */
const W_BAND_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/** 05 §5.1 的窗口关闭保鲜期，与 15 §3 的 `publication.window_closing_freshness_days` 同源。 */
export const WINDOW_CLOSING_FRESHNESS_DAYS = 14;

/**
 * W 档是否在最近 `days` 天内下降过（05 §5.1 必要条件 2）。
 *
 * 判据必须带日期。无日期的档位数组只能把"第一格"当作过去，而它可能是任意久远的
 * 读数——那样一次半年前的降档会在今天触发 `WINDOW_CLOSING`，把仍有抢跑价值的窗口
 * 提前判成关闭（15 §3 把"空槽窗口被泄露"列为 0 容忍的 P0 事故）。
 *
 * `INSUFFICIENT` 不算降档：它表示"没有信号"，不是"信号变弱"。把数据缺失读成窗口
 * 关闭，等于让采集失败伪装成市场结论——正是 05 §5.0 发布门槛要挡的那类错误。
 *
 * 只判定**最近一次**降档：更早的降档只会离今天更远，最近一次不在窗口内则更早的
 * 必然也不在。
 *
 * `asOf` 缺省时取历史中最新一格的日期（即"以最近一次观测为今天"）。调用方应显式
 * 传入当前 `obs_date`：本函数不读挂钟，同一输入必得同一结果。
 */
export function wDroppedWithin(
  history: DatedWBand[] | undefined,
  days: number,
  asOf?: string
): boolean {
  if (!history || history.length < 2) return false;
  const reference = asOf ?? history[history.length - 1]?.obsDate;
  const referenceMs = Date.parse(`${reference}T00:00:00Z`);
  if (Number.isNaN(referenceMs)) return false;
  const cutoffMs = referenceMs - days * 86_400_000;

  for (let i = history.length - 1; i > 0; i--) {
    const newer = history[i];
    const older = history[i - 1];
    const newerRank = W_BAND_RANK[newer.band];
    const olderRank = W_BAND_RANK[older.band];
    if (newerRank === undefined || olderRank === undefined) continue;
    if (newerRank >= olderRank) continue;
    const atMs = Date.parse(`${newer.obsDate}T00:00:00Z`);
    return !Number.isNaN(atMs) && atMs >= cutoffMs && atMs <= referenceMs;
  }
  return false;
}

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
  /** Distinct days of organic SERP observations for the primary query (05 §5.0). */
  serpHistoryDays?: number;
  /** Whether the most recent snapshot is an accepted organic search result. */
  recentSerpSnapshotAvailable?: boolean;
  /** A critical collector failed for this batch while the caller carried on. */
  criticalSourceFailure?: boolean;
  /** 本期观测日（`YYYY-MM-DD`），窗口判据的"今天"。 */
  obsDate?: string;
}

export interface VerdictResult {
  verdict: Verdict;
  rawVerdict: Verdict;
  flags: string[];
  reason: string;
  rulesTriggered: string[];
  /** False when 05 §5.0 forced this cycle's output down to WATCH. */
  publicationEligible: boolean;
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

  // ---- 05 §5.0 publication eligibility -------------------------------------
  // Evaluated before any upgrade rule. Anything listed here means this cycle's
  // observation is not yet a publishable decision, so it must not reach
  // BUILD_NOW / EARLY_BET (or WINDOW_CLOSING) no matter how the axes look.
  // Fields left undefined by a caller do not participate, so callers that do not
  // collect SERP history keep their previous behaviour.
  const minHistoryDays = isFastTrack ? 7 : 14;
  const publicationFailures: string[] = [];
  if (historyDays < minHistoryDays) publicationFailures.push('BASELINE_PERIOD');
  if (dBand === 'INSUFFICIENT') publicationFailures.push('D_INSUFFICIENT');
  if (input.serpHistoryDays !== undefined && input.serpHistoryDays < minHistoryDays) {
    publicationFailures.push('SERP_HISTORY_BELOW_BASELINE');
  }
  if (input.recentSerpSnapshotAvailable === false) publicationFailures.push('NO_RECENT_ORGANIC_SERP');
  if (mSummary.inferredOnly) publicationFailures.push('M_INFERRED_ONLY');
  if (input.criticalSourceFailure) publicationFailures.push('CRITICAL_SOURCE_FAILURE');
  const publicationEligible = publicationFailures.length === 0;

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

  // 05 §5.1 必要条件 2 要的是"降档发生在 obs_date 前 14 天内"，而上面那个比较没
  // 有日期：它把 `wBandHistory[0]` 当作过去，那可能是任意久远的读数。有带日期的
  // 历史就以它为准，没有（不采集逐日历史的老调用方）才退回旧行为。
  //
  // 带日期的历史只从 `prev` 取，不另开一个同名的入参：两处入口意味着漏传一处就会
  // 静默退回那个宽松判据，而这正是本判据要消灭的东西。
  const datedHistory = prev?.datedWBandHistory;
  const wDroppedInWindow =
    datedHistory && datedHistory.length >= 2
      ? wDroppedWithin(datedHistory, WINDOW_CLOSING_FRESHNESS_DAYS, input.obsDate)
      : wDroppedRecently;

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
    // 07 §6.1: pricing pages with no transaction proxy, revenue disclosure or
    // persistence are decoration, and decoration caps M at MEDIUM — it must not
    // clear the standard BUILD_NOW bar. The MEDIUM case is what the compensated
    // rule below exists for.
    const mVerifiedStandard =
      mSummary.band === 'HIGH' &&
      (!mSummary.pricingDecorationOnly ||
        Boolean(mSummary.hasTransactionTraction) ||
        (mSummary.persistentPricedDomains ?? 0) >= 1);

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
        wDroppedInWindow) ||
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

  // 2. Publication gate (05 §5.0).
  //    A rejected cycle publishes nothing: neither axis state nor debounce may
  //    upgrade it. A strong negative signal still resolves to PASS, because PASS
  //    is a rejection rather than a published opportunity claim.
  if (!publicationEligible && !negativeM) {
    for (const failure of publicationFailures) {
      if (!flags.includes(failure)) flags.push(failure);
    }
    if (!flags.includes('PARTIAL_DATA')) flags.push('PARTIAL_DATA');
    rulesTriggered.push('PUBLICATION_GATE_BLOCKED');
    return {
      verdict: 'WATCH',
      rawVerdict: 'WATCH',
      flags,
      reason:
        'Publication gate not met for this observation cycle (' +
        publicationFailures.join(', ') +
        '); the record stays under observation and no upgrade is published.',
      rulesTriggered,
      publicationEligible: false,
    };
  }

  // 3. Debounce logic
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
    publicationEligible: true,
  };
}
