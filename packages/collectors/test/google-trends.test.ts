import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseTrendsSeries, TRENDS_WINDOW_90D } from '../src';

/**
 * Google Trends 解析：缺失点是“没有数据”，不是“热度为 0”。
 * 把它当 0 会把 Google 的虚线读成“没人搜”，这是需求判断里最危险的一种错觉。
 */
function envelope(items: any[], statusCode = 20000) {
  return { tasks: [{ status_code: statusCode, result: [{ items }] }] };
}

function graph(data: any[]) {
  return { type: 'google_trends_graph', data };
}

describe('Google Trends 解析', () => {
  it('取 graph 的 data，按日期排序并算均值/变化/峰值', () => {
    const series = parseTrendsSeries(
      envelope([
        graph([
          { date_from: '2026-08-02', date_to: '2026-08-08', values: [20] },
          { date_from: '2026-07-26', date_to: '2026-08-01', values: [10] },
          { date_from: '2026-08-09', date_to: '2026-08-15', values: [30] },
          { date_from: '2026-08-16', date_to: '2026-08-22', values: [40] },
        ]),
      ]),
      TRENDS_WINDOW_90D
    );
    assert.ok(series);
    assert.deepStrictEqual(series!.points.map((p) => p.date), [
      '2026-07-26',
      '2026-08-02',
      '2026-08-09',
      '2026-08-16',
    ]);
    assert.strictEqual(series!.points[0].value, 10);
    assert.strictEqual(series!.average, 25);
    assert.strictEqual(series!.change, 1.333, '后半段 (30+40)/2=35 vs 前半段 (10+20)/2=15 → +133.3%');
    assert.strictEqual(series!.peak?.value, 40);
  });

  it('missing_data 的点被丢弃，不当成 0', () => {
    const series = parseTrendsSeries(
      envelope([
        graph([
          { date_from: '2026-08-02', date_to: '2026-08-08', values: [20] },
          { date_from: '2026-08-09', date_to: '2026-08-15', values: [0], missing_data: true },
        ]),
      ]),
      TRENDS_WINDOW_90D
    );
    assert.strictEqual(series!.points.length, 1);
    assert.strictEqual(series!.average, 20);
  });

  it('任务被拒（HTTP 200 + status_code≠20000）返回 null，不是空序列', () => {
    assert.strictEqual(parseTrendsSeries(envelope([], 40000), TRENDS_WINDOW_90D), null);
  });

  it('没有 data 字段时返回 null，不假装“零热度”', () => {
    assert.strictEqual(parseTrendsSeries(envelope([{ type: 'google_trends_graph' }]), TRENDS_WINDOW_90D), null);
  });

  it('前半段为 0 时不给变化率', () => {
    const series = parseTrendsSeries(
      envelope([
        graph([
          { date_from: '2026-08-02', values: [0] },
          { date_from: '2026-08-09', values: [0] },
          { date_from: '2026-08-16', values: [30] },
          { date_from: '2026-08-23', values: [40] },
        ]),
      ]),
      TRENDS_WINDOW_90D
    );
    assert.strictEqual(series!.change, null);
  });
});
