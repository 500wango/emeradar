import { BasisState } from './types';

/** 账本行中决定"判定依据是否留存"的那几列。 */
export interface LedgerBasisRow {
  hash_version?: number | null;
  explanation?: unknown;
  flags?: string[] | null;
}

/**
 * 由账本行判定依据的留存状态。
 *
 * 口径与 schema.sql 的 `verdicts_v2_requires_basis` 约束一致：hash_version >= 2
 * 的行必然带 explanation。存量行（hash_version = 1）三者皆空，那是"账本没记"，
 * 不是"没有问题" —— 界面必须如实说明，否则沉默会被读成"筛查干净"。
 *
 * 判空一律看 explanation，不看 flags：`[]` 是"本期确实没有任何标志"的合法值，
 * 拿它做判据会把干净记录与未留存记录混为一谈。
 *
 * FLAGS_ONLY 是防御分支：有标志却没有轨迹时，标志仍然必须展示出来。
 */
export function deriveBasisState(row: LedgerBasisRow | null | undefined): BasisState {
  if (!row) return 'NOT_RETAINED';
  if (Number(row.hash_version ?? 1) >= 2 && row.explanation != null) return 'RECORDED';
  if ((row.flags ?? []).length > 0) return 'FLAGS_ONLY';
  return 'NOT_RETAINED';
}
