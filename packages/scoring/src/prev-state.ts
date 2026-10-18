import { Lifecycle, Verdict } from '@emeradar/core';
import { AxisBand, DatedWBand, PrevScoringState } from './types';

/** 上一期账本行中参与去抖的字段。 */
export interface LedgerRowPrevInput {
  verdict: Verdict;
  /** 上一期封存的去抖前值；早于依据留存功能的存量行为 null。 */
  rawVerdict: Verdict | null;
  lifecycle: Lifecycle;
  /** 发布裁决已连续保持的天数（上一期为止）。 */
  daysInCurrentVerdict: number;
  /**
   * 生命周期阶段已连续保持的天数。必须与 verdict 的天数分开统计：
   * lifecycle 的"长期未变"判据是 60 天（lifecycle.ts §6），量级差一个数量级，
   * 拿 verdict 的天数顶替会把它变成一个几乎恒真的条件。
   */
  daysInCurrentLifecycle: number;
  /** 逐日窗口档位，旧→新排列；仅含封存了真实档位的行。 */
  wBandHistory: AxisBand[];
  /**
   * 与 `wBandHistory` 同源、但带观测日期的序列。05 §5.1 的"14 天内下降"判据只能
   * 建立在它之上：`wBandHistory` 丢掉了日期，无法区分"昨天降档"与"半年前降档"。
   */
  datedWBandHistory?: DatedWBand[];
}

/**
 * 由上一期账本行构造去抖所需的 PrevScoringState。
 *
 * rawVerdict 为 null 时保守回退到发布值：该机会的首期升级因此需要原始信号连续
 * 两天到齐（多等一天），此后随着 v2 行写入即自愈为常规两日去抖。
 *
 * 不要把这里改成"NULL 视为已确认"：那会让长期积压的原始信号一次性放出，
 * 产生一波非预期的 BUILD_NOW 洪峰。去抖要的是"连续两天看到同样的原始值"。
 */
export function buildPrevScoringState(row: LedgerRowPrevInput): PrevScoringState {
  return {
    verdict: row.verdict,
    rawVerdict: row.rawVerdict ?? row.verdict,
    lifecycle: row.lifecycle,
    daysInCurrentVerdict: row.daysInCurrentVerdict,
    daysInCurrentLifecycle: row.daysInCurrentLifecycle,
    wBandHistory: row.wBandHistory,
    datedWBandHistory: row.datedWBandHistory,
  };
}
