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
 * 提前判成关闭（15 §3 把"活跃窗口被提前公开"列为 0 容忍的 P0 事故）。
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
  /** Distinct days of organic SERP observations for the primary query (05 §5.0). */
  serpHistoryDays?: number;
  /** Whether the most recent snapshot is an accepted organic search result. */
  recentSerpSnapshotAvailable?: boolean;
  /** A critical collector failed for this batch while the caller carried on. */
  criticalSourceFailure?: boolean;
  /** Sources whose latest success is 72h stale; the verdict is still published with this flag. */
  staleSources?: string[];
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
  if (input.staleSources && input.staleSources.length > 0) {
    flags.push('STALE_DATA');
  }

  const isFastTrack = Boolean(input.fastTrack) || (historyDays >= 7 && historyDays < 14 && dBand !== 'INSUFFICIENT');

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
  if (input.criticalSourceFailure) publicationFailures.push('CRITICAL_SOURCE_FAILURE');
  const publicationEligible = publicationFailures.length === 0;

  // Flag detection
  if (negativeM) {
    flags.push('M_NEGATIVE');
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

  // 05 §5.1 必要条件 2 / §5.3 `W_DROPPING`。拥挤度已退出 W，展示用 W 与市场 W 恒等，
  // 因此只需一条带日期的 W 序列；缺日期时宁可漏报，不误报。
  //
  // `W_DROPPING` 只是"窗口在恶化"的提示，不改变裁决顺序：它在本函数末尾、最终
  // 裁决确定之后才打，且只在最终仍是 `BUILD_NOW` / `EARLY_BET` 时打。
  const wDroppedInWindow = wDroppedWithin(
    prev?.datedWBandHistory,
    WINDOW_CLOSING_FRESHNESS_DAYS,
    input.obsDate
  );

  // 1. Calculate raw verdict
  //
  // 单值短路，先命中先返回，不叠加（05 §5、01 §1.8 第 2 条）：
  //   PASS → WINDOW_CLOSING → BUILD_NOW(标准) → BUILD_NOW(补偿) → EARLY_BET → WATCH
  //
  // 顺序本身是规格的一部分：`PASS` 在最前，所以 D=LOW / W=LOW / 强负面 M 的机会
  // 不会因为"窗口正在关闭"而被抬成 WINDOW_CLOSING。反过来，`WINDOW_CLOSING`
  // 又先于两条 BUILD_NOW——窗口已经在关，就不该再喊建。
  let raw: Verdict = 'WATCH';
  let reason = '';

  const dGeMedium = dBand === 'HIGH' || dBand === 'MEDIUM';
  const wGeMedium = wBand === 'HIGH' || wBand === 'MEDIUM';
  const confGeMedium = confidence === 'HIGH' || confidence === 'MEDIUM';

  // 07 §6.1: pricing pages with no transaction proxy, revenue disclosure or
  // persistence are decoration, and decoration caps M at MEDIUM — it must not
  // clear the standard BUILD_NOW bar. The MEDIUM case is what the compensated
  // rule below exists for.
  const mVerifiedStandard =
    mSummary.band === 'HIGH' &&
    (!mSummary.pricingDecorationOnly ||
      Boolean(mSummary.hasTransactionTraction) ||
      (mSummary.persistentPricedDomains ?? 0) >= 1);

  // PRD v2.2 Q1：补偿要求 M=HIGH，或 M=MEDIUM 且含交易代理 / 定价持续 ≥ 90 天。
  // 只凭独立定价站数量不再足够——那是多站静态 PRICING_DECORATION。
  const mCompensatedVerified =
    mVerifiedStandard ||
    mSummary.band === 'HIGH' ||
    (mSummary.band === 'MEDIUM' &&
      (Boolean(mSummary.hasTransactionTraction) || (mSummary.persistentPricedDomains ?? 0) >= 1));
  // PRD §5.7：M 仅靠 INFERRED 支撑时不得 BUILD_NOW，但允许 EARLY_BET。
  const buildNowAllowed = !mSummary.inferredOnly;

  const isEarlyBet =
    (dBand === 'HIGH' && wGeMedium) ||
    (isFastTrack && dGeMedium && wBand === 'HIGH');

  // 此前**已发布**过 BUILD_NOW / EARLY_BET：窗口关闭只对这类机会成立
  // （05 §5.1）；从未开过窗的机会谈不上"关闭"。
  const prevPublishedActive = prev?.verdict === 'BUILD_NOW' || prev?.verdict === 'EARLY_BET';

  if (dBand === 'LOW' || negativeM || wBand === 'LOW') {
    raw = 'PASS';
    rulesTriggered.push('RULE_PASS');
    reason = negativeM
      ? 'Strong negative commercial evidence observed.'
      : dBand === 'LOW'
      ? 'Demand volume or momentum is too low.'
      : 'Competitive window is closed by incumbents.';
  } else if (prevPublishedActive && wDroppedInWindow && wGeMedium) {
    // 14 天内 W 降 ≥1 档，且当前 W 仍 ≥ MEDIUM 才叫"正在关闭"；降到 LOW 的机会
    // 已被上面的 PASS 接住——窗口已经关了，不是"在关"。
    raw = 'WINDOW_CLOSING';
    rulesTriggered.push('RULE_WINDOW_CLOSING');
    reason = 'Incumbents entering SERP or window closing. Immediate action or pivot required.';
  } else if (buildNowAllowed && dGeMedium && mVerifiedStandard && wGeMedium && confGeMedium) {
    raw = 'BUILD_NOW';
    rulesTriggered.push('RULE_BUILD_NOW');
    reason =
      'All signals aligned: verified commercial monetization, high/medium demand, open window, and strong evidence.';
  } else if (buildNowAllowed && dBand === 'HIGH' && wBand === 'HIGH' && mCompensatedVerified && confGeMedium) {
    raw = 'BUILD_NOW';
    rulesTriggered.push('RULE_BUILD_NOW_COMPENSATED');
    reason =
      'Feature-compensated build: breakout demand and open competitive window compensate for developing commercial proof.';
  } else if (
    isEarlyBet &&
    (mSummary.band === 'LOW' || mSummary.band === 'MEDIUM' || mSummary.band === 'INSUFFICIENT')
  ) {
    raw = 'EARLY_BET';
    rulesTriggered.push('RULE_EARLY_BET');
    reason =
      'High demand or fast-track momentum with open competitive window and unverified commercial signal. Early builder opportunity.';
  } else {
    raw = 'WATCH';
    rulesTriggered.push('RULE_WATCH');
    reason = 'Signals are emerging or data is accumulating. Keep on radar.';
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

  // 4. W_DROPPING 后置：只有在最终仍给出主动作结论时才打。
  //    先打会与裁决自相矛盾——上面两条短路（PASS / WINDOW_CLOSING）已经"消费"
  //    了这次降档，再贴一个"W 在降"的标志只会让下游误以为还有窗口可抢。
  if (wDroppedInWindow && (published === 'BUILD_NOW' || published === 'EARLY_BET')) {
    flags.push('W_DROPPING');
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
