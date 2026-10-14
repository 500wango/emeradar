import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 两条曾经静默失效的不变量。
 *
 * 它们在出问题时都不会抛异常，只会给出一个偏掉的数字或一个混进索引的页面，
 * 所以必须由测试钉住，而不是靠"看起来对"。
 */
const harness = makeDisposableDb('emeradar_claim_invariants');

before(async () => { await harness.setup(); });
after(async () => { await harness.teardown(); });

test('归档项目不再被算作占用槽位（D2）', async (t) => {
  if (!harness.available) return t.skip(harness.skipReason);
  const { query } = harness.db;
  const { activeClaimPredicate } = harness.services;

  await query(`INSERT INTO users (id, email) VALUES ('u_claim_test', 'claim-test@emeradar.test')`);
  await query(`INSERT INTO opportunities (id, slug, title, recommended_archetype)
    VALUES ('opp_claim_test', 'claim-test', 'Claim counting fixture', 'TOOL')`);

  // 三种状态各一行。旧代码的谓词是 `status != 'ABANDONED'`，而 ABANDONED 不是
  // projects.status 的合法取值，于是这个条件恒为真 —— 归档项目照样被计入。
  await query(`INSERT INTO projects (id, user_id, opportunity_id, project_kind, title, build_type, status, stake_deadline_at) VALUES
    ('prj_claim_a', 'u_claim_test', 'opp_claim_test', 'FORMAL', 'Active',      'TOOL', 'IN_DEVELOPMENT', NOW() + INTERVAL '7 days'),
    ('prj_claim_b', 'u_claim_test', 'opp_claim_test', 'FORMAL', 'Launched',    'TOOL', 'LAUNCHED',       NOW() + INTERVAL '7 days'),
    ('prj_claim_c', 'u_claim_test', 'opp_claim_test', 'FORMAL', 'Archived',    'TOOL', 'ARCHIVED',       NOW() + INTERVAL '7 days')`);

  const res = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM projects WHERE opportunity_id = $1 AND ${activeClaimPredicate()}`,
    ['opp_claim_test']
  );

  // 关键在 2 而不是 3：归档这一行必须落选。
  assert.strictEqual(res.rows[0].n, 2, '只有 IN_DEVELOPMENT 与 LAUNCHED 算作占用');

  const predicate = activeClaimPredicate('p');
  assert.match(predicate, /^p\.status <> 'ARCHIVED'$/);
  assert.ok(!predicate.includes('ABANDONED'), '非法取值不得再出现在认领判定里');
});

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
