import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 构建形态的不变量：只接受规范取值，历史拼写在读取路径上归一化。
 *
 * 它们在出问题时都不会抛异常，只会让同一个形态在库里分裂成两套，所以必须由测试
 * 钉住，而不是靠"看起来对"。
 *
 * 认领/槽位那一条随 `claim-policy.ts` 一起删除了：v3.1 没有槽位可占用。
 */
const harness = makeDisposableDb('emeradar_archetype_invariants');

before(async () => { await harness.setup(); });
after(async () => { await harness.teardown(); });

test('构建形态只接受 00-INDEX §4.3 的规范取值', async (t) => {
  if (!harness.available) return t.skip(harness.skipReason);
  const { query } = harness.db;

  // LIGHTWEIGHT_TOOL 曾经与 TOOL 并存为两个成员，使同一个形态在库里分裂成两套，
  // 按 archetype 取键的槽位容量因此被静默拆开。CHECK 让这种拼写不可能再落库。
  await assert.rejects(
    query(`INSERT INTO opportunities (id, slug, title, recommended_archetype)
           VALUES ('opp_bad_archetype', 'bad-archetype', 'Legacy spelling', 'LIGHTWEIGHT_TOOL')`),
    (error: any) => error?.code === '23514',
    '旧拼写应当被 CHECK 拒绝'
  );

  const ok = await query<{ recommended_archetype: string }>(
    `INSERT INTO opportunities (id, slug, title, recommended_archetype)
     VALUES ('opp_good_archetype', 'good-archetype', 'Canonical spelling', 'TOOL')
     RETURNING recommended_archetype`
  );
  assert.strictEqual(ok.rows[0].recommended_archetype, 'TOOL');
});

test('历史拼写在读取路径上被归一化', async (t) => {
  if (!harness.available) return t.skip(harness.skipReason);
  const core = await import('@emeradar/core');

  assert.strictEqual(core.normalizeArchetype('LIGHTWEIGHT_TOOL'), 'TOOL');
  assert.strictEqual(core.normalizeArchetype('TOOL'), 'TOOL');
  // 未知取值原样透出，由调用方决定拒绝还是接受 —— 归一化不是校验。
  assert.strictEqual(core.normalizeArchetype('SOMETHING_ELSE'), 'SOMETHING_ELSE');
  assert.ok(core.isBuildArchetype('MICRO_SAAS'));
  assert.ok(!core.isBuildArchetype('LIGHTWEIGHT_TOOL'));
});
