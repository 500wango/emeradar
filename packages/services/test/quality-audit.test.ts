import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  BAD_REASONS,
  QC_CSV_HEADER,
  toQcCsv,
  computePrecisionAtK,
  type QcLabelRow,
} from '../src/quality-audit';

/**
 * 审计工作单第 3 条：人工质检需要稳定的 bad_reason 枚举与 CSV 结构，
 * Precision@10 需要一个确定性的计算器（`label_FINAL_GO` 前十条中为 GO 的比例）。
 */
describe('质检样本导出与标注结构（工作单 3）', () => {
  it('bad_reason 枚举覆盖审计列出的失败类别', () => {
    const required = [
      'NEWS_QUERY',
      'NO_TASK_EVIDENCE',
      'AUTOCOMPLETE_ARTIFACT_GROWTH',
      'SERP_IRRELEVANT_TOOL',
      'VERDICT_LEAKED_TO_FEED',
      'ICP_MISMATCH',
      'COMMERCIAL_COVERAGE_PENDING',
      'DUPLICATE_CLUSTER',
    ];
    for (const reason of required) {
      assert.ok(BAD_REASONS.includes(reason as (typeof BAD_REASONS)[number]), reason);
    }
  });

  it('CSV 头包含人工标签列与留痕列', () => {
    for (const col of [
      'label_VALID_TASK',
      'label_DEMAND_EVIDENCE',
      'label_SERP_SATISFACTION',
      'label_MONETIZATION_EVIDENCE',
      'label_SOLO_BUILDABLE',
      'label_FINAL_GO',
      'bad_reason',
    ]) {
      assert.ok(QC_CSV_HEADER.includes(col), col);
    }
  });

  it('toQcCsv 转义逗号与引号', () => {
    const csv = toQcCsv([
      { opportunity_id: 'o1', bad_reason: 'NEWS_QUERY', notes: 'a,b "c"' } as Record<string, unknown>,
    ]);
    const line = csv.split('\n')[1];
    assert.ok(line.includes('"a,b ""c"""'));
  });

  it('computePrecisionAtK 只统计前 K 条，空样本返回 null', () => {
    const labels: QcLabelRow[] = Array.from({ length: 12 }, (_, i) => ({ finalGo: i < 3 }));
    assert.strictEqual(computePrecisionAtK(labels, 10), 0.3);
    assert.strictEqual(computePrecisionAtK(labels, 2), 1);
    assert.strictEqual(computePrecisionAtK([], 10), null);
  });
});
