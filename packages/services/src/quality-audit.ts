/**
 * 机会质量审计的标注结构（2026-10-23 审计工作单第 3 条）。
 *
 * `quality-audit` 是纯模块：bad_reason 枚举、QC CSV 结构、Precision@K 计算。
 * 数据导出在 `scripts/export-quality-sample.ts`（只读），影子重算在
 * `scripts/shadow-rescore.ts`（只读）。样本标注流程见
 * docs/quality-audit-2026-10-23.md。
 */

/**
 * 人工标注的失败原因（可多选）。每个值对应审计报告的一类已确认机制，
 * 标注者只能从这里选，保证样本间口径一致。
 */
export const BAD_REASONS = [
  /** 新闻/事件型标题被机械拼成了工具查询（审计 01）。 */
  'NEWS_QUERY',
  /** 查询没有可服务的软件任务：无独立需求信号（审计 01）。 */
  'NO_TASK_EVIDENCE',
  /** 需求增长来自采集加深/补齐旧词，不是真实搜索上升（审计 04）。 */
  'AUTOCOMPLETE_ARTIFACT_GROWTH',
  /** SERP 里的工具页与目标查询无关，竞争/缺口被误判（审计 02）。 */
  'SERP_IRRELEVANT_TOOL',
  /** WATCH/PASS/低置信度出现在了可构建首屏（审计 03）。 */
  'VERDICT_LEAKED_TO_FEED',
  /** 机会不适合目标 ICP：GPU 依赖、强合规、维护负担过重（审计 07）。 */
  'ICP_MISMATCH',
  /** 商业结论缺抽样覆盖支撑，却以高可信面目出现（审计 06）。 */
  'COMMERCIAL_COVERAGE_PENDING',
  /** 与另一条机会是同一需求的变体，重复观测（去重口径漏网）。 */
  'DUPLICATE_CLUSTER',
  /** SERP 解释文本与数字不一致/不可解释（审计 05 类）。 */
  'UNEXPLAINABLE_SCORE',
  /** 采集失败/降级被当成市场结论。 */
  'STALE_DATA_AS_SIGNAL',
] as const;

export type BadReason = (typeof BAD_REASONS)[number];

/**
 * QC CSV 列结构。`label_*` 列由人工填写（y/n/unsure），
 * `bad_reason` 取 BAD_REASONS（可 `|` 分隔多值），其余由导出脚本预填。
 */
export const QC_CSV_HEADER = [
  'opportunity_id',
  'slug',
  'primary_query',
  'verdict',
  'd_band',
  'm_band',
  'w_band',
  'confidence',
  'discovery_source',
  'first_observed_at',
  'label_VALID_TASK',
  'label_DEMAND_EVIDENCE',
  'label_SERP_SATISFACTION',
  'label_MONETIZATION_EVIDENCE',
  'label_SOLO_BUILDABLE',
  'label_FINAL_GO',
  'bad_reason',
  'notes',
] as const;

export type QcCsvRow = Record<(typeof QC_CSV_HEADER)[number], unknown>;

/** Precision@K 的最小标注行：只要求人工终审结论。 */
export interface QcLabelRow {
  finalGo: boolean;
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 行 → CSV。首行表头；含逗号/引号/换行的字段按 RFC 4180 转义。 */
export function toQcCsv(rows: Array<Partial<QcCsvRow>>): string {
  const lines = [QC_CSV_HEADER.join(',')];
  for (const row of rows) {
    lines.push(QC_CSV_HEADER.map((col) => csvEscape(row[col])).join(','));
  }
  return lines.join('\n');
}

/**
 * Precision@K（审计质量评估口径）：前 K 条中人工判 FINAL_GO 的比例。
 * 样本为空时返回 null（0% 会把「没标注」误读成「全错」）。
 */
export function computePrecisionAtK(labels: QcLabelRow[], k = 10): number | null {
  if (labels.length === 0 || k <= 0) return null;
  const top = labels.slice(0, k);
  const good = top.filter((label) => label.finalGo).length;
  return Math.round((good / top.length) * 100) / 100;
}
