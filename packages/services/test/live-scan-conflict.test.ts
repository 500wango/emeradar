import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 回归：主词已作为「簇内词/种子词」存在于 queries 时，扫描不能 500。
 *
 * `queries` 上有 (query_text, market_country, research_language) 唯一约束，
 * 旧代码只写 `ON CONFLICT (id) DO NOTHING`，插入会撞文本唯一约束 → 整个扫描失败。
 * 联想词扩簇与种子长尾都会写 queries，所以这不是边缘情况。
 */
const harness = makeDisposableDb('emeradar_live_scan_conflict_test');

before(async () => {
  await harness.setup();
  if (!harness.available) return;
});

after(async () => {
  await harness.teardown();
});

describe('Live Scan 主词冲突', () => {
  it('词已作为簇内词存在时仍能完成扫描并复用已有 query id', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO queries (id, query_text, market_country, research_language, tier)
       VALUES ('qry_existing_cluster', 'pdf unlock offline', 'US', 'en-US', 'C')`
    );

    const result = await harness.services.LiveScanService.scan({ query: 'pdf unlock offline' });
    assert.ok(result.opportunityId);
    assert.strictEqual(result.status, 'CANDIDATE');

    // 必须挂到已存在的那条 query 上，而不是新建一条同文本的。
    const linked = await query<{ query_id: string }>(
      `SELECT oq.query_id FROM opportunity_queries oq
        WHERE oq.opportunity_id = $1 AND oq.role = 'PRIMARY'`,
      [result.opportunityId]
    );
    assert.strictEqual(linked.rows[0].query_id, 'qry_existing_cluster');

    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM queries WHERE query_text = 'pdf unlock offline'`
    );
    assert.strictEqual(count.rows[0].n, 1, '不得产生同文本的重复 query 行');
  });

  it('二次扫描同一词返回已有机会，不重复建行', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const again = await harness.services.LiveScanService.scan({ query: 'pdf unlock offline' });
    assert.strictEqual(again.isNew, false);
  });
});
