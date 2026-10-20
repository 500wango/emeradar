import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deriveTrend } from '../src/demand-enrichment.service';

/**
 * 趋势判据必须保守：数据不足 6 个月就说“不知道”，不把噪声叫趋势。
 * 阈值 ±15%：低于它的波动算 FLAT。
 */
function series(values: number[]) {
  return values.map((searchVolume, index) => ({ year: 2025, month: index + 1, searchVolume }));
}

describe('需求趋势推导', () => {
  it('后 3 个月比前 3 个月高 15% 以上 → GROWING', () => {
    assert.strictEqual(deriveTrend(series([100, 100, 100, 150, 150, 150])), 'GROWING');
  });

  it('低 15% 以上 → DECLINING', () => {
    assert.strictEqual(deriveTrend(series([200, 200, 200, 100, 100, 100])), 'DECLINING');
  });

  it('波动小于 15% → FLAT', () => {
    assert.strictEqual(deriveTrend(series([100, 100, 100, 105, 105, 105])), 'FLAT');
  });

  it('不足 6 个月不判趋势，返回 null', () => {
    assert.strictEqual(deriveTrend(series([100, 200, 300])), null);
  });

  it('乱序月份按时间排序后再比', () => {
    const shuffled = [
      { year: 2025, month: 6, searchVolume: 150 },
      { year: 2025, month: 1, searchVolume: 100 },
      { year: 2025, month: 4, searchVolume: 150 },
      { year: 2025, month: 2, searchVolume: 100 },
      { year: 2025, month: 5, searchVolume: 150 },
      { year: 2025, month: 3, searchVolume: 100 },
    ];
    assert.strictEqual(deriveTrend(shuffled), 'GROWING');
  });

  it('前 3 个月为 0 时不给结论', () => {
    assert.strictEqual(deriveTrend(series([0, 0, 0, 100, 100, 100])), null);
  });
});
