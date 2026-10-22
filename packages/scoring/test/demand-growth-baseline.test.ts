import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateDemandScore } from '../src';

/**
 * 审计问题 04（P0）：newQueries7d 数的是「近 7 天第一次被采到」的联想词，
 * 采集加深、补齐旧词、供应商波动都会被解释成“需求增长”。修复口径：
 *   - 评分只吃持久新词（newQueriesPersistent7d：近 7 天内 ≥2 个观测日重复出现）；
 *   - 可比基线不足 30 天时，增长分量清零、不得给出 HIGH 档——只展示「新发现」；
 *   - 不传新字段时保持旧行为（历史调用方兼容）。
 */
describe('需求增长与采集伪增长的拆分（审计 04）', () => {
  const base = {
    clusterSize: 10,
    clusterGrowth30d: 1.2,
    expansionSlope30d: 0.8,
    attentionSourcesActive14d: 2,
    attentionGrowth14d: 4,
  };

  it('基线不足 30 天：增长分量清零，不得产生 HIGH 档，理由说明「仅新发现」', () => {
    const res = calculateDemandScore({
      ...base,
      newQueries7d: 20, // 补齐旧词刷出来的数字
      newQueriesPersistent7d: 2,
      historyDays: 14,
      growthBaselineDays: 14,
    });
    assert.notStrictEqual(res.band, 'HIGH');
    assert.strictEqual(res.growthMeasurable, false);
    assert.match(res.reason, /new-discovery|baseline/i);
  });

  it('同一输入、基线充足：HIGH 可达，growthMeasurable 为真', () => {
    const res = calculateDemandScore({
      ...base,
      newQueries7d: 20,
      newQueriesPersistent7d: 20,
      historyDays: 45,
      growthBaselineDays: 45,
    });
    assert.strictEqual(res.band, 'HIGH');
    assert.strictEqual(res.growthMeasurable, true);
  });

  it('补齐旧词抬高 raw 新词数、持久新词不变时，分数不得变化', () => {
    const before = calculateDemandScore({
      ...base,
      newQueries7d: 4,
      newQueriesPersistent7d: 4,
      historyDays: 45,
      growthBaselineDays: 45,
    });
    const afterBackfill = calculateDemandScore({
      ...base,
      newQueries7d: 40,
      newQueriesPersistent7d: 4,
      historyDays: 45,
      growthBaselineDays: 45,
    });
    assert.strictEqual(
      afterBackfill.basisPoints,
      before.basisPoints,
      '单纯加深采集/补齐旧词不得提高增长分'
    );
  });

  it('持久新词确实更多时才得更高的分（评分吃持久口径）', () => {
    const low = calculateDemandScore({
      ...base,
      newQueries7d: 40,
      newQueriesPersistent7d: 1,
      historyDays: 45,
      growthBaselineDays: 45,
    });
    const high = calculateDemandScore({
      ...base,
      newQueries7d: 40,
      newQueriesPersistent7d: 12,
      historyDays: 45,
      growthBaselineDays: 45,
    });
    assert.ok(high.basisPoints > low.basisPoints);
  });

  it('不传新字段时保持旧行为（历史调用方兼容）', () => {
    const legacy = calculateDemandScore({ ...base, newQueries7d: 6, historyDays: 45 });
    assert.strictEqual(legacy.band, 'HIGH');
    assert.strictEqual(legacy.growthMeasurable, true);
  });
});
