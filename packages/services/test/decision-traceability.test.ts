import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 决策溯源：裁决账本与用户真正落地的项目之间的那个接缝。
 *
 * 这套用例自己建一个一次性数据库（见 helpers/disposable-db.ts），而不是复用
 * `pnpm db:migrate` 那个库。原因是 verdicts 是只追加的：夹具要造两条裁决才能验证
 * "决策锚定的是哪一条"，而只追加触发器保证那两行永远删不掉。写进开发库就等于往
 * 账本里塞两条永远不会消失的假裁决 —— 而账本是产品对外的可信度本身。
 *
 * 为什么要在这里做端到端而不是只测纯函数：这一轮修掉的缺陷正是"每个模块各自
 * 看起来都对、串起来才断"。老的 createProject 在自己那一层有完整的前置校验，
 * 单测全绿，但它会在用户没给 decisionId 时**自己造一条 GO** —— 只有把决策服务、
 * 项目服务、两个 API 路由和视图层串起来跑，才看得见那条凭空出现的授权。
 */

const harness = makeDisposableDb('emeradar_decision_test');

const OPP = 'opp_decision_test';
const OPP_OTHER = 'opp_decision_test_other';
const USER = 'usr_decision_test';
const USER_OTHER = 'usr_decision_test_other';
/** 并发重复 GO 专用：自己的额度计数，不与别的用例共享。 */
const USER_SHARED = 'usr_decision_test_shared';
const VERDICT_V1 = 'vdt_decision_test_v1';
const VERDICT_V2 = 'vdt_decision_test_v2';
const VERDICT_OTHER = 'vdt_decision_test_other';
/** 并发重复 GO 专用：验证事务回滚时配额与决策一起收走的边界。 */
const OPP_SHARED = 'opp_decision_test_noslots';
const VERDICT_SHARED = 'vdt_decision_test_shared';

async function seedFixture() {
  const { query } = harness.db;

  // plans 是 subscriptions 的外键目标，schema.sql 不含数据行（seed.ts 才写）。
  await query(
    `INSERT INTO plans (code, name, price_usd_monthly, entitlements)
     VALUES ('PRO', 'Builder Pro', 29.00,
       '{"view_cards_monthly": -1, "generate_reports_monthly": 30, "export_reports_monthly": 30,
         "max_projects": 50, "max_alerts": 20, "feed_delay_days": 0, "api_access": false,
         "atomic_go_export_monthly": 3}')
     ON CONFLICT (code) DO NOTHING`
  );

  for (const id of [USER, USER_OTHER, USER_SHARED]) {
    await query(
      `INSERT INTO users (id, email, display_name, role, tier)
       VALUES ($1, $2, $3, 'USER', 'PRO')`,
      [id, `${id}@emeradar.test`, id]
    );
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_end)
       VALUES ($1, $2, 'PRO', 'ACTIVE', NOW() + INTERVAL '30 days')`,
      [`sub_${id}`, id]
    );
  }

  for (const [opportunityId, slug] of [
    [OPP, 'decision-test'],
    [OPP_OTHER, 'decision-test-other'],
    [OPP_SHARED, 'decision-test-noslots'],
  ] as const) {
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ($1, $2, $3, 'TRACKED', '2026-01-01')`,
      [opportunityId, slug, slug]
    );
    await query(
      `INSERT INTO opportunity_cards (
         opportunity_id, slug, primary_query, verdict, lifecycle,
         d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
         confidence, recommended_archetype, execution_class, why_now_summary,
         top_idea, first_observed_at
       ) VALUES ($1, $2, 'decision test query', 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', 'HIGH', 'HIGH',
         'HIGH', 'TOOL', 'WEEKEND', 'fixture', 'fixture', NOW())`,
      [opportunityId, slug]
    );
  }

  // 同一机会下的两条裁决 —— "决策锚定的是哪一条"才有可判定的对象。
  for (const [id, opportunityId, obsDate] of [
    [VERDICT_V1, OPP, '2026-10-05'],
    [VERDICT_V2, OPP, '2026-10-06'],
    [VERDICT_OTHER, OPP_OTHER, '2026-10-06'],
    [VERDICT_SHARED, OPP_SHARED, '2026-10-06'],
  ] as const) {
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
         prev_hash, row_hash)
       VALUES ($1, $2, $3::date, '1.0', 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', $4, $5)`,
      [id, opportunityId, obsDate, '0'.repeat(64), id.padEnd(64, '0')]
    );
  }
}

/** 断言调用以指定 HTTP 语义失败。 */
async function expectError(fn: () => Promise<unknown>, status: number, what: string) {
  try {
    await fn();
  } catch (error: any) {
    assert.strictEqual(error?.status, status, `${what}: 期望 ${status}，实得 ${error?.status}（${error?.message}）`);
    return;
  }
  assert.fail(`${what}: 期望 ${status}，但调用成功了`);
}

describe('决策溯源（决策 ↔ 裁决 ↔ 项目）', () => {
  before(async () => {
    await harness.setup();
    if (harness.available) await seedFixture();
  });

  after(async () => {
    await harness.teardown();
  });

  it('GO 把决策锚定在用户当时看到的那一条裁决上', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService, calculateDecisionRowHash } = harness.services;

    const result = await DecisionService.goAndExport(USER, {
      opportunityId: OPP,
      archetype: 'TOOL',
      verdictId: VERDICT_V1,
    });

    const project = (
      await harness.db.query<any>(`SELECT * FROM projects WHERE id = $1`, [result.projectId])
    ).rows[0];
    assert.strictEqual(project.opportunity_id, OPP);
    assert.strictEqual(project.credential_status, 'UNVERIFIED', 'GO 落地的项目不是 UNVERIFIED');

    // 项目引用的决策必须是这个用户、这条机会上的一条 GO —— 而不是"某条看起来像
    // 授权的记录"。决策由 GO 事务自己写入，所以这里能同时钉住"存在"与"归属"。
    const row = (
      await harness.db.query<any>(`SELECT * FROM decisions WHERE id = $1`, [project.decision_id])
    ).rows[0];
    assert.ok(row, '项目引用了一条不存在的决策');
    assert.strictEqual(row.decision, 'GO');
    assert.strictEqual(row.user_id, USER);
    assert.strictEqual(row.opportunity_id, OPP);
    assert.strictEqual(row.verdict_id, VERDICT_V1, '决策没有锚定用户当时看到的那条裁决');
    assert.strictEqual(
      row.verdict_row_hash,
      VERDICT_V1.padEnd(64, '0'),
      '没有把裁决行的内容指纹一并钉住'
    );

    // 指纹必须能从行本身复算出来，否则"可验证"只是说法。
    assert.strictEqual(
      calculateDecisionRowHash({
        id: row.id,
        opportunityId: row.opportunity_id,
        userId: row.user_id,
        decision: row.decision,
        verdictId: row.verdict_id,
        verdictRowHash: row.verdict_row_hash,
        reasons: row.reasons,
        channel: row.channel,
      }),
      row.row_hash,
      'row_hash 无法从落库的行复算'
    );
  });

  it('同一 (用户, 机会, 裁决) 的 GO 幂等：409 ALREADY_GO，配额不再扣减', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    const first = await harness.db.query<{ id: string; decision_id: string }>(
      `SELECT id, decision_id FROM projects WHERE user_id = $1 AND opportunity_id = $2`,
      [USER, OPP]
    );
    assert.strictEqual(first.rows.length, 1, '上一个用例应当已经建出一条项目');

    await expectError(
      () => DecisionService.goAndExport(USER, { opportunityId: OPP, archetype: 'TOOL', verdictId: VERDICT_V1 }),
      409,
      '重复 GO'
    );

    // 409 的响应要带上既有项目：重试的客户端据此跳转，而不是再点一次。
    try {
      await DecisionService.goAndExport(USER, { opportunityId: OPP, archetype: 'TOOL', verdictId: VERDICT_V1 });
    } catch (error: any) {
      assert.strictEqual(error?.code, 'ALREADY_GO');
      assert.strictEqual(error?.details?.project_id, first.rows[0].id);
    }

    const projects = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects WHERE user_id = $1 AND opportunity_id = $2`,
      [USER, OPP]
    );
    assert.strictEqual(projects.rows[0].count, 1, '重复 GO 造出了第二个项目');

    const decisions = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM decisions WHERE user_id = $1 AND opportunity_id = $2 AND decision = 'GO'`,
      [USER, OPP]
    );
    assert.strictEqual(decisions.rows[0].count, 1, '重复 GO 造出了第二条决策');

    const counter = await harness.db.query<{ used: number }>(
      `SELECT used FROM usage_counters WHERE user_id = $1 AND feature = 'atomic_go_export_monthly'`,
      [USER]
    );
    assert.strictEqual(counter.rows[0]?.used ?? 0, 1, '重复 GO 又扣了一次配额——两次点击两次付费');

    // 换一条裁决是**另一个**决定：新的 decision、新的项目、新的配额。
    const onNewerVerdict = await DecisionService.goAndExport(USER, {
      opportunityId: OPP,
      archetype: 'TOOL',
      verdictId: VERDICT_V2,
    });
    assert.notStrictEqual(onNewerVerdict.projectId, first.rows[0].id, '换了裁决却复用了同一个项目');
    const after = await harness.db.query<{ used: number }>(
      `SELECT used FROM usage_counters WHERE user_id = $1 AND feature = 'atomic_go_export_monthly'`,
      [USER]
    );
    assert.strictEqual(after.rows[0]?.used ?? 0, 2, '第二条裁决的 GO 没有计费');
  });

  it('PASS 需要至少一个合法理由，非法理由被丢弃而不是存下来', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    await expectError(
      () => DecisionService.record(USER, { opportunityId: OPP, verdictId: VERDICT_V1, decision: 'PASS', reasons: [] }),
      400,
      'PASS 无理由'
    );
    await expectError(
      () =>
        DecisionService.record(USER, {
          opportunityId: OPP,
          verdictId: VERDICT_V1,
          decision: 'PASS',
          reasons: ['NOT_A_REAL_REASON'],
        }),
      400,
      'PASS 全是非法理由'
    );

    const passed = await DecisionService.record(USER, {
      opportunityId: OPP,
      verdictId: VERDICT_V1,
      decision: 'PASS',
      reasons: ['DEMAND_TOO_THIN', 'BOGUS'],
    });
    const row = (await harness.db.query<any>(`SELECT reasons FROM decisions WHERE id = $1`, [passed.id])).rows[0];
    assert.deepStrictEqual(row.reasons, ['DEMAND_TOO_THIN'], '非法理由没有被过滤');
  });

  it('PASS 不允许引用不属于该机会的裁决', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await expectError(
      () =>
        harness.services.DecisionService.record(USER, {
          opportunityId: OPP,
          verdictId: VERDICT_OTHER,
          decision: 'PASS',
          reasons: ['DEMAND_TOO_THIN'],
        }),
      409,
      '跨机会引用裁决'
    );
  });

  it('POST /decisions 的旁路关闭：record 只收 PASS，GO 必须走原子入口', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    // v3.1：GO = 扣配额 + 建项目 + 授权点火包。这个只记录意见的端点若收下 GO，
    // 就成了一条不扣配额、不建项目的旁路（ADR-018）。
    await expectError(
      () => DecisionService.record(USER, { opportunityId: OPP, verdictId: VERDICT_V1, decision: 'GO' }),
      400,
      'record 收下了 GO'
    );

    const decisions = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM decisions WHERE user_id = $1 AND decision = 'GO'`,
      [USER]
    );
    assert.strictEqual(decisions.rows[0].count, 2, '旁路写入了额外的 GO 决策');
  });

  it('GO 只写 Project 壳：不产生凭证行，凭证状态停在 UNVERIFIED', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    const started = await DecisionService.goAndExport(USER_OTHER, {
      opportunityId: OPP_OTHER,
      archetype: 'TOOL',
      verdictId: VERDICT_OTHER,
    });

    // v3.1 的 GO 只有三件事：配额、决策、Project 壳。凭证是之后的自愿动作。
    const credentials = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM project_credentials WHERE project_id = $1`,
      [started.projectId]
    );
    assert.strictEqual(credentials.rows[0].count, 0, 'GO 事务里仍然写了凭证');

    const project = await harness.db.query<{ credential_status: string; launch_date: Date | null }>(
      `SELECT credential_status, launch_date FROM projects WHERE id = $1`,
      [started.projectId]
    );
    assert.strictEqual(project.rows[0].credential_status, 'UNVERIFIED');
    assert.strictEqual(project.rows[0].launch_date, null);
  });

  it('重复 GO 不会立出第二个项目（不变量 I6）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    // USER_OTHER 在上一个用例里已经在这条机会上 GO 过。
    await expectError(
      () => DecisionService.goAndExport(USER_OTHER, { opportunityId: OPP_OTHER, archetype: 'TOOL', verdictId: VERDICT_OTHER }),
      409,
      '同一用户在同一机会上二次 GO'
    );

    const projects = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects WHERE user_id = $1 AND opportunity_id = $2`,
      [USER_OTHER, OPP_OTHER]
    );
    assert.strictEqual(projects.rows[0].count, 1, '重复 GO 造出了第二个项目');

    // I6 在存储层的兜底：一个 decision_id 至多一条项目，即使有人绕过服务层。
    const project = (
      await harness.db.query<any>(`SELECT id, decision_id FROM projects WHERE user_id = $1 AND opportunity_id = $2`, [USER_OTHER, OPP_OTHER])
    ).rows[0];
    await assert.rejects(
      () => harness.db.query(
        `INSERT INTO projects (id, user_id, opportunity_id, decision_id, title, build_type)
         VALUES ('prj_i6_dup', $1, $2, $3, 'dup', 'TOOL')`,
        [USER_OTHER, OPP_OTHER, project.decision_id]
      ),
      (error: any) => error?.code === '23505' && String(error?.constraint ?? '') === 'idx_projects_decision',
      '同一个 decision_id 被允许挂两个项目'
    );
  });

  it('并发重复 GO：一个成功、一个 409 ALREADY_GO，配额只扣一次', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    // 两个请求争同一个 decision。一个建项目，另一个要么在事务内的预检查命中，
    // 要么撞唯一索引——两种都要回滚配额，最后由 409 收尾。
    const results = await Promise.allSettled([
      DecisionService.goAndExport(USER_SHARED, { opportunityId: OPP_SHARED, archetype: 'TOOL', verdictId: VERDICT_SHARED }),
      DecisionService.goAndExport(USER_SHARED, { opportunityId: OPP_SHARED, archetype: 'TOOL', verdictId: VERDICT_SHARED }),
    ]);

    const winners = results.filter((result) => result.status === 'fulfilled');
    assert.strictEqual(winners.length, 1, `并发重复 GO 产生了 ${winners.length} 个成功`);
    const loser = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.strictEqual(loser.reason?.code, 'ALREADY_GO');
    assert.strictEqual(loser.reason?.status, 409);

    const counter = await harness.db.query<{ used: number }>(
      `SELECT used FROM usage_counters WHERE user_id = $1 AND feature = 'atomic_go_export_monthly'`,
      [USER_SHARED]
    );
    assert.strictEqual(counter.rows[0]?.used ?? 0, 1, '失败的 GO 没有回滚配额');

    const projects = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects WHERE user_id = $1 AND opportunity_id = $2`,
      [USER_SHARED, OPP_SHARED]
    );
    assert.strictEqual(projects.rows[0].count, 1, '并发重复 GO 建出了两条项目');
  });

  it('裁决不属于这条机会时无法 GO（422 PRECONDITION_FAILED）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    await expectError(
      () => DecisionService.goAndExport(USER_OTHER, {
        opportunityId: OPP_OTHER,
        archetype: 'TOOL',
        verdictId: VERDICT_V1,
      }),
      422,
      '跨机会引用裁决 GO'
    );
    await expectError(
      () => DecisionService.goAndExport(USER_OTHER, {
        opportunityId: OPP_OTHER,
        archetype: 'TOOL',
        verdictId: 'vdt_does_not_exist',
      }),
      422,
      '引用不存在的裁决 GO'
    );
  });

  it('决策行不可改写，但项目一旦引用它就删不掉', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    // 用一条**没有项目**的 GO 决策。v3.1 的 GO 一定会建项目，所以这种行只能由
    // 数据层直接写入（例如历史存量）。本条测的是追加写触发器对 DELETE 的放行。
    await query(
      `INSERT INTO decisions (id, opportunity_id, user_id, decision, verdict_id, reasons, channel)
       VALUES ('dcs_orphan_go', $1, $2, 'GO', $3, '{}', 'WEB')`,
      [OPP, USER, VERDICT_V2]
    );

    await assert.rejects(
      () => query(`UPDATE decisions SET reasons = '{OTHER}' WHERE id = 'dcs_orphan_go'`),
      (error: any) => error?.code === '0A000',
      '决策行被允许改写'
    );

    // DELETE 必须放行。注意这**不是**在保护账号注销 —— 注销是软删
    // （admin.service.ts 把 users.status 置为 DELETED），应用代码里没有
    // `DELETE FROM users`。放行 DELETE 是为了保住测试夹具的清理路径，以及
    // 将来真正的擦除请求（硬删）不至于被永久堵死。
    await query(`DELETE FROM decisions WHERE id = 'dcs_orphan_go'`);
    const remaining = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM decisions WHERE id = 'dcs_orphan_go'`
    );
    assert.strictEqual(remaining.rows[0].count, 0, '决策行删不掉');

    // 与之相对：落过项的决策不能删。这不是限制，而是**记录完整性**——删它会级联
    // 掉用户的项目，而项目是用户真正交付的东西。
    //
    // 这条保护的物理依据是 `projects.decision_id` 的 NO ACTION（0019 第 6 节）：
    // 删除一条被项目引用的决策会失败，项目不会跟着静默消失。
    const claimed = (
      await query<{ decision_id: string }>(
        `SELECT decision_id FROM projects WHERE user_id = $1 AND opportunity_id = $2`,
        [USER, OPP]
      )
    ).rows[0];
    assert.ok(claimed, '夹具里应当有一条已立项的项目');
    await assert.rejects(
      () => query(`DELETE FROM decisions WHERE id = $1`, [claimed.decision_id]),
      (error: any) => error?.code === '23503' && String(error?.constraint ?? '') === 'projects_decision_id_fkey',
      '落过项的决策被允许删除 —— 项目会跟着静默消失'
    );
  });
});
