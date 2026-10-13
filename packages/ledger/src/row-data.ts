import { Verdict, Lifecycle, Confidence, Band } from '@emeradar/core';
import { HashVersion, PredictionSpec, VerdictExplanation, VerdictRowData } from './row-hash';

/** verdicts 表的一行（列名与数据库一致）。验证路径直接拿它构造哈希输入。 */
export interface LedgerRowRecord {
  opportunity_id: string;
  obs_date: string;
  scoring_config_version: string;
  verdict: string;
  lifecycle: string;
  d_basis_points: number;
  m_basis_points: number;
  w_basis_points: number;
  confidence: string;
  input_snapshot_ids: string[] | null;
  cited_evidence_ids: string[] | null;
  /** 链上指针；不参与本行的哈希输入，但验证时需要逐行比对。 */
  prev_hash: string;
  row_hash: string;
  hash_version?: number | string | null;
  raw_verdict?: string | null;
  flags?: string[] | null;
  explanation?: VerdictExplanation | null;
  features_hash?: string | null;
  d_band?: string | null;
  m_band?: string | null;
  w_band?: string | null;
  /**
   * v3 行发布的预测规格。**查询这一行的 SQL 必须把它选出来**，否则 v3 行会被当成
   * "规格为 null"复算 —— 有规格的行因此验不过（响亮地失败，方向是对的，但排查
   * 的人会以为是账本坏了而不是少选了一列）。
   */
  prediction_spec?: PredictionSpec | null;
}

/**
 * 把账本行还原成哈希输入，并给出该行**写入时**使用的版本。
 *
 * 版本必须以 hash_version 列为准，不能从数据形状推断：v2/v3 行残缺时形状会
 * 撒谎，而版本决定了用哪套字段集复算 —— 用错版本会让合法行验不过，
 * 公开的账本验证端点随即对那一天整体报失败。
 *
 * 字段一律照抄，缺列保持缺失。verifyRowHash 会把残缺行判为"验不过"，
 * 这正是我们想要的结果：坏数据应当验不过，而不是被悄悄补成合法值。
 */
export function buildRowHashInput(row: LedgerRowRecord): {
  data: VerdictRowData;
  hashVersion: HashVersion;
} {
  // 从 1/2/3 三个版本**逐一枚举**，而不是 `>= 2 ? 2 : 1` 那样的区间折叠。
  // 后者会把 3 塌缩成 2：v3 行随即按 v2 的字段集复算，每一天都验不过 ——
  // 而这是"新版本上线"必然触发的路径，不是边界情况。
  //
  // ≥3 的未知版本归到 3：本验证器不认识的新版本复算必然对不上，于是如实报
  // "验不过"。这正是想要的答案 —— 旧验证器无法验证新格式的行，而不是它
  // 假装该行坏了或假装自己验过了。
  const declared = Number(row.hash_version ?? 1);
  const hashVersion: HashVersion = declared >= 3 ? 3 : declared === 2 ? 2 : 1;

  const base = {
    opportunityId: row.opportunity_id,
    obsDate: row.obs_date,
    scoringConfigVersion: row.scoring_config_version,
    verdict: row.verdict as Verdict,
    lifecycle: row.lifecycle as Lifecycle,
    dBasisPoints: row.d_basis_points,
    mBasisPoints: row.m_basis_points,
    wBasisPoints: row.w_basis_points,
    confidence: row.confidence as Confidence,
    inputSnapshotIds: row.input_snapshot_ids ?? [],
    citedEvidenceIds: row.cited_evidence_ids ?? [],
  };

  if (hashVersion === 1) {
    return { data: base, hashVersion };
  }

  const v2 = {
    ...base,
    rawVerdict: (row.raw_verdict ?? undefined) as unknown as Verdict,
    flags: row.flags as unknown as string[],
    explanation: row.explanation as unknown as VerdictExplanation,
    featuresHash: row.features_hash ?? null,
    dBand: (row.d_band ?? undefined) as unknown as Band,
    mBand: (row.m_band ?? undefined) as unknown as Band,
    wBand: (row.w_band ?? undefined) as unknown as Band,
  };

  if (hashVersion === 2) {
    return { hashVersion, data: v2 };
  }

  // v3：规格键必须存在（值可为 null），见 isV3Row / isCompleteV3Row。
  return {
    hashVersion,
    data: {
      ...v2,
      predictionSpec: (row.prediction_spec ?? null) as PredictionSpec | null,
    },
  };
}
