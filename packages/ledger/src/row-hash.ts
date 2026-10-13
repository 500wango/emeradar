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

/**
 * 预测规格：这一行**当时声明**自己该被什么判据检验（06 §7「评估规格版本化并
 * 预先固定（在观测结果前写定）」）。
 *
 * 为什么必须入账而不是"读代码里的常量"：判据活在 `prediction-episode.service.ts`
 * 的静态常量里（`NEW_QUERY_THRESHOLD = 10` 等），而常量是可编辑的。把
 * `NEW_QUERY_THRESHOLD` 从 10 改成 5，此后**所有尚未评估的历史 Episode** 都会按
 * 新阈值判定，而它们自己的 `metrics.evalSpecVersion` 仍然写着 `ev-1.0` —— 记录
 * 说"我按 ev-1.0 判的"，实际判据却是另一个东西，且没有任何地方会报错。这就是
 * 一次静默的历史改写：不需要 UPDATE 任何一行账本，只要改一个常量。
 *
 * 所以规格随预测一起封存：行内数据自证"我预言 X 会在 Y 天内发生、判据是 Z"，
 * 复核者不必信任当年的代码常量。
 */
export interface PredictionSpec {
  /** 判据版本（06 §7 的 `eval_spec`），如 `ev-1.0`。 */
  criteriaVersion: string;
  /** 评估地平线（天）。集合语义，哈希前排序。 */
  horizons: number[];
  /** 被判定的目标事件，如 `market_formed`。 */
  target: string;
}

/**
 * v3 行：v2 的全部字段，外加这一行发布的预测规格（未发布预测的行显式写 null）。
 *
 * `predictionSpec` **必须存在**（可以为 null），这是 v3 与 v2 的唯一区别：v2 行是
 * "不知道它有没有预测"，v3 行是"知道，要么是这个规格、要么没有"。用"键是否存在"
 * 而不是"值是否为对象"来识别 v3，正是为了让"确实没有预测"（null）与"旧格式"
 * 不混为一谈 —— 后者若被当成 v3 复算，会算出一个与写入时不同的哈希。
 */
export interface VerdictRowDataV3 extends VerdictRowDataV2 {
  predictionSpec: PredictionSpec | null;
}

export type VerdictRowData = VerdictRowDataV1 | VerdictRowDataV2 | VerdictRowDataV3;
export type HashVersion = 1 | 2 | 3;

export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * v2 及其后续版本共有的"依据字段是否在"的判别。v3 行也带 rawVerdict，所以
 * 对 v3 行它也返回 true —— 判断具体版本请用 isV3Row，或（权威地）读
 * `hash_version` 列，见 row-data.ts。
 */
export function isV2Row(row: VerdictRowData): row is VerdictRowDataV2 {
  return typeof (row as Partial<VerdictRowDataV2>).rawVerdict === 'string';
}

/** v3 的判据是**键存在**，不是值为对象 —— 见 VerdictRowDataV3 的说明。 */
export function isV3Row(row: VerdictRowData): row is VerdictRowDataV3 {
  return Object.prototype.hasOwnProperty.call(row, 'predictionSpec');
}

function isWellFormedSpec(spec: unknown): spec is PredictionSpec {
  if (typeof spec !== 'object' || spec === null) return false;
  const candidate = spec as Partial<PredictionSpec>;
  return (
    typeof candidate.criteriaVersion === 'string' &&
    typeof candidate.target === 'string' &&
    Array.isArray(candidate.horizons) &&
    candidate.horizons.every((h) => typeof h === 'number' && Number.isFinite(h))
  );
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

/**
 * v3 行的字段是否齐全：v2 的依据字段 + `predictionSpec` 键在，且其值要么是 null
 * 要么结构完整。
 *
 * 规格残缺（例如 horizons 不是数组）由这里判否，而不是让哈希函数抛错 ——
 * 一个畸形行应当只是"这条验不过"，不能让整天的账本验证中断。
 */
export function isCompleteV3Row(row: unknown): row is VerdictRowDataV3 {
  if (!isCompleteV2Row(row)) return false;
  if (!Object.prototype.hasOwnProperty.call(row, 'predictionSpec')) return false;
  const spec = (row as Partial<VerdictRowDataV3>).predictionSpec;
  return spec === null || isWellFormedSpec(spec);
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

/**
 * v2 的哈希体。抽出来是为了让 v3 在**完全相同的字段集**上追加，而不是复制一遍：
 * 复制出来的第二份字段列表迟早会与第一份漂移，而漂移的代价是已发布的默克尔根
 * 全部失效。
 */
function v2Body(row: VerdictRowDataV2): Record<string, unknown> {
  return {
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
  };
}

/** v2 哈希：11 个字段 + 判定依据。 */
export function calculateRowHashV2(prevHash: string, row: VerdictRowDataV2): string {
  return hashRow(prevHash, v2Body(row));
}

/**
 * v3 哈希：v2 的字段集 + 预测规格。
 *
 * 地平线是集合语义（06 §7 的 `h ∈ {30,60,90}`，顺序不承载信息），因此排序后再入
 * 哈希 —— 与 ids/flags 同理。规格为 null 时显式哈希 null，而不是省略该键：省略
 * 会让"没有预测"和"这一版还没这个字段"算出同一个值。
 */
export function calculateRowHashV3(prevHash: string, row: VerdictRowDataV3): string {
  const spec = row.predictionSpec;
  return hashRow(prevHash, {
    ...v2Body(row),
    predictionSpec:
      spec === null
        ? null
        : {
            criteriaVersion: spec.criteriaVersion,
            horizons: [...spec.horizons].sort((a, b) => a - b),
            target: spec.target,
          },
  });
}

/**
 * 版本分派。签名保持不变，既有调用点无需改动。
 *
 * v3 必须先判：v3 行也带 rawVerdict，先判 v2 会把它们按 v2 的字段集复算。
 *
 * hash_version 本身不参与哈希：纳入会改变存量行的 row_hash，而版本是自校验的
 * —— 用错版本算不出相同值（见 ledger.test.ts 的版本绑定用例）。
 */
export function calculateRowHash(prevHash: string, row: VerdictRowData): string {
  if (isV3Row(row)) return calculateRowHashV3(prevHash, row);
  return isV2Row(row) ? calculateRowHashV2(prevHash, row) : calculateRowHashV1(prevHash, row);
}

export function verifyRowHash(
  prevHash: string,
  row: VerdictRowData,
  expectedRowHash: string,
  hashVersion?: HashVersion
): boolean {
  const version = hashVersion ?? (isV3Row(row) ? 3 : isV2Row(row) ? 2 : 1);

  // 声明了版本却字段残缺时不抛异常。验证处在整条链的遍历里，一个畸形行
  // 抛出 TypeError 会中断全部校验 —— 它应该只是"这条验不过"。
  if (version === 3 && !isCompleteV3Row(row)) return false;
  if (version === 2 && !isCompleteV2Row(row)) return false;

  const calculated =
    version === 3
      ? calculateRowHashV3(prevHash, row as VerdictRowDataV3)
      : version === 2
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
