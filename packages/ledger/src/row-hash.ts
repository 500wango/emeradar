import { createHash } from 'node:crypto';
import { canonicalizeJson } from './canonical';
import { Verdict, Lifecycle, Confidence, Band } from '@emeradar/core';

/** v1 行：账本最初的 11 个字段，语义就此冻结。 */
export interface VerdictRowDataV1 {
  opportunityId: string;
  obsDate: string; // YYYY-MM-DD
  scoringConfigVersion: string;
  verdict: Verdict;
  lifecycle: Lifecycle;
  dBasisPoints: number;
  mBasisPoints: number;
  wBasisPoints: number;
  confidence: Confidence;
  inputSnapshotIds: string[];
  citedEvidenceIds: string[];
}

/** 规则命中轨迹（06 §3），与 ScoringOutput.explanation 结构一致。 */
export interface VerdictExplanation {
  dReason: string;
  mReason: string;
  wReason: string;
  verdictReason: string;
  rulesTriggered: string[];
}

/**
 * v2 行：在 11 个字段之外追加判定依据。06 §4.1 要求哈希覆盖"除 row_hash、
 * computed_at 外的全部列"，依据字段因此参与哈希 —— 事后改写理由会被链上发现。
 */
export interface VerdictRowDataV2 extends VerdictRowDataV1 {
  rawVerdict: Verdict;
  flags: string[];
  explanation: VerdictExplanation;
  featuresHash: string | null;
  /**
   * 三轴档位。basis_points 无法反推档位（INSUFFICIENT 与 LOW 的分界取决于
   * 历史天数、采集成败等非数值条件），而窗口收窄检测需要逐日真实档位，
   * 所以档位本身必须入账。
   */
  dBand: Band;
  mBand: Band;
  wBand: Band;
}

export type VerdictRowData = VerdictRowDataV1 | VerdictRowDataV2;
export type HashVersion = 1 | 2;

export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * 版本由数据形状自证：v2 行必带 rawVerdict。存量行（由 seed 自造哈希写入）
 * 与 hash_version=1 的行都不带该字段。
 */
export function isV2Row(row: VerdictRowData): row is VerdictRowDataV2 {
  return typeof (row as Partial<VerdictRowDataV2>).rawVerdict === 'string';
}

/**
 * v2 行的字段是否齐全。来自数据库的 row 是运行时数据，可能缺列或为 NULL；
 * 只判 rawVerdict 会让残缺行走进哈希函数并抛出 TypeError。
 */
export function isCompleteV2Row(row: unknown): row is VerdictRowDataV2 {
  if (typeof row !== 'object' || row === null) return false;
  const candidate = row as Partial<VerdictRowDataV2>;
  return (
    typeof candidate.rawVerdict === 'string' &&
    Array.isArray(candidate.flags) &&
    candidate.explanation != null &&
    candidate.dBand != null &&
    candidate.mBand != null &&
    candidate.wBand != null
  );
}

function hashRow(prevHash: string, body: unknown): string {
  const hash = createHash('sha256');
  hash.update(prevHash, 'utf8');
  hash.update(canonicalizeJson(body), 'utf8');
  return hash.digest('hex');
}

/**
 * v1 哈希。字段**显式列出**而非展开 rowData：展开会让将来新增到 v2 的字段
 * 悄悄进入 v1 的计算，存量行的 row_hash 随即无法自洽。JCS 对对象键排序，
 * 所以显式列出的书写顺序不影响结果。
 */
export function calculateRowHashV1(prevHash: string, row: VerdictRowDataV1): string {
  return hashRow(prevHash, {
    opportunityId: row.opportunityId,
    obsDate: row.obsDate,
    scoringConfigVersion: row.scoringConfigVersion,
    verdict: row.verdict,
    lifecycle: row.lifecycle,
    dBasisPoints: row.dBasisPoints,
    mBasisPoints: row.mBasisPoints,
    wBasisPoints: row.wBasisPoints,
    confidence: row.confidence,
    inputSnapshotIds: [...row.inputSnapshotIds].sort(),
    citedEvidenceIds: [...row.citedEvidenceIds].sort(),
  });
}

/** v2 哈希：11 个字段 + 判定依据。 */
export function calculateRowHashV2(prevHash: string, row: VerdictRowDataV2): string {
  return hashRow(prevHash, {
    opportunityId: row.opportunityId,
    obsDate: row.obsDate,
    scoringConfigVersion: row.scoringConfigVersion,
    verdict: row.verdict,
    lifecycle: row.lifecycle,
    dBasisPoints: row.dBasisPoints,
    mBasisPoints: row.mBasisPoints,
    wBasisPoints: row.wBasisPoints,
    confidence: row.confidence,
    inputSnapshotIds: [...row.inputSnapshotIds].sort(),
    citedEvidenceIds: [...row.citedEvidenceIds].sort(),
    // 标志是集合语义，排序消除顺序歧义（与上面两个 id 列表同理）。
    flags: [...row.flags].sort(),
    rawVerdict: row.rawVerdict,
    dBand: row.dBand,
    mBand: row.mBand,
    wBand: row.wBand,
    // 规则轨迹保留原序：它记录的是评估执行先后，写入顺序由 verdict.ts 固定。
    explanation: {
      dReason: row.explanation.dReason,
      mReason: row.explanation.mReason,
      wReason: row.explanation.wReason,
      verdictReason: row.explanation.verdictReason,
      rulesTriggered: row.explanation.rulesTriggered,
    },
    featuresHash: row.featuresHash ?? null,
  });
}

/**
 * 版本分派。签名保持不变，既有调用点无需改动。
 *
 * hash_version 本身不参与哈希：纳入会改变存量行的 row_hash，而版本是自校验的
 * —— 用错版本算不出相同值（见 ledger.test.ts 的版本绑定用例）。
 */
export function calculateRowHash(prevHash: string, row: VerdictRowData): string {
  return isV2Row(row) ? calculateRowHashV2(prevHash, row) : calculateRowHashV1(prevHash, row);
}

export function verifyRowHash(
  prevHash: string,
  row: VerdictRowData,
  expectedRowHash: string,
  hashVersion?: HashVersion
): boolean {
  const version = hashVersion ?? (isV2Row(row) ? 2 : 1);

  // 声明 v2 却字段残缺时不抛异常。验证处在整条链的遍历里，一个畸形行
  // 抛出 TypeError 会中断全部校验 —— 它应该只是"这条验不过"。
  if (version === 2 && !isCompleteV2Row(row)) return false;

  const calculated =
    version === 2
      ? calculateRowHashV2(prevHash, row as VerdictRowDataV2)
      : calculateRowHashV1(prevHash, row as VerdictRowDataV1);
  return calculated.toLowerCase() === expectedRowHash.toLowerCase();
}

/** 对封存的特征快照取 JCS 指纹，用于 features_hash 列。 */
export function calculateFeaturesHash(features: unknown): string {
  const hash = createHash('sha256');
  hash.update(canonicalizeJson(features), 'utf8');
  return hash.digest('hex');
}
