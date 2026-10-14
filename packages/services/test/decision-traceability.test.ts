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
const VERDICT_V1 = 'vdt_decision_test_v1';
const VERDICT_V2 = 'vdt_decision_test_v2';
const VERDICT_OTHER = 'vdt_decision_test_other';
/** 一条**没有槽位行**的机会：用来验证占槽失败时整个 GO 事务（含配额）回滚。 */
const OPP_SHARED = 'opp_decision_test_noslots';
const VERDICT_SHARED = 'vdt_decision_test_shared';

async function seedFixture() {
  const { query } = harness.db;

  // plans 是 subscriptions 的外键目标，schema.sql 不含数据行（seed.ts 才写）。
  await query(
    `INSERT INTO plans (code, name, price_usd_monthly, entitlements)
     VALUES ('PRO', 'Builder Pro', 29.00,
       '{"view_cards_monthly": -1, "generate_reports_monthly": 30, "export_reports_monthly": 30,
         "max_projects": 50, "max_alerts": 20, "feed_delay_days": 0, "api_access": false}')
     ON CONFLICT (code) DO NOTHING`
  );

  for (const id of [USER, USER_OTHER]) {
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
    // 槽位行由 observe 路径在发布时物化；这个夹具直接 INSERT 机会，所以要自己补。
    // 不补的话任何 GO 都会得到 400「这个形态没开放」——那是夹具的缺口，不是被测行为。
    if (opportunityId !== OPP_SHARED) {
      await query(
        `INSERT INTO opportunity_slots (opportunity_id, archetype, capacity)
         VALUES ($1, 'TOOL', 2), ($1, 'PSEO_SITE', 2)`,
        [opportunityId]
      );
    }
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

    const decision = await DecisionService.record(USER, {
      opportunityId: OPP,
      verdictId: VERDICT_V1,
      decision: 'GO',
    });
    assert.strictEqual(decision.verdictId, VERDICT_V1);

    const row = (
      await harness.db.query<any>(`SELECT * FROM decisions WHERE id = $1`, [decision.id])
    ).rows[0];
    assert.strictEqual(row.verdict_id, VERDICT_V1, '存下的不是被引用的那一条裁决');
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

  it('同一 (用户, 机会, 裁决) 的 GO 幂等，换一条裁决才是新决策', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    const first = await DecisionService.record(USER, {
      opportunityId: OPP,
      verdictId: VERDICT_V1,
      decision: 'GO',
    });
    const repeat = await DecisionService.record(USER, {
      opportunityId: OPP,
      verdictId: VERDICT_V1,
      decision: 'GO',
    });
    assert.strictEqual(repeat.id, first.id, '重复的 GO 造出了第二条决策');

    const onNewerVerdict = await DecisionService.record(USER, {
      opportunityId: OPP,
      verdictId: VERDICT_V2,
      decision: 'GO',
    });
    assert.notStrictEqual(onNewerVerdict.id, first.id, '换了裁决却复用了同一条决策');
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

  it('引用不属于该机会的裁决会被拒绝', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await expectError(
      () =>
        harness.services.DecisionService.record(USER, {
          opportunityId: OPP,
          verdictId: VERDICT_OTHER,
          decision: 'GO',
        }),
      409,
      '跨机会引用裁决'
    );
  });

  it('原子 GO 落地的项目引用它自己的 GO 决策', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    const result = await DecisionService.goAndExport(USER, {
      opportunityId: OPP,
      archetype: 'TOOL',
      verdictId: VERDICT_V1,
    });

    const project = (
      await harness.db.query<any>(`SELECT * FROM projects WHERE id = $1`, [result.projectId])
    ).rows[0];
    assert.strictEqual(project.opportunity_id, OPP);

    // 项目引用的决策必须是这个用户、这条机会上的一条 GO —— 而不是"某条看起来像
    // 授权的记录"。决策由 GO 事务自己写入，所以这里能同时钉住"存在"与"归属"。
    const decision = (
      await harness.db.query<any>(`SELECT * FROM decisions WHERE id = $1`, [project.decision_id])
    ).rows[0];
    assert.ok(decision, '项目引用了一条不存在的决策');
    assert.strictEqual(decision.decision, 'GO');
    assert.strictEqual(decision.user_id, USER);
    assert.strictEqual(decision.opportunity_id, OPP);
    assert.strictEqual(decision.verdict_id, VERDICT_V1, '决策没有锚定用户当时看到的那条裁决');
  });

  it('重复 GO 不会立出第二个项目（不变量 I6）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    // 该用户在上一个用例里已经在这条机会上 GO 过并持有槽位。
    await expectError(
      () => DecisionService.goAndExport(USER, { opportunityId: OPP, archetype: 'TOOL', verdictId: VERDICT_V1 }),
      409,
      '同一用户在同一机会上二次 GO'
    );

    const projects = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects WHERE user_id = $1 AND opportunity_id = $2`,
      [USER, OPP]
    );
    assert.strictEqual(projects.rows[0].count, 1, '重复 GO 造出了第二个项目');

    // I6 在存储层的兜底：一个 decision_id 至多一条项目，即使有人绕过服务层。
    const project = (
      await harness.db.query<any>(`SELECT id, decision_id FROM projects WHERE user_id = $1 AND opportunity_id = $2`, [USER, OPP])
    ).rows[0];
    await assert.rejects(
      () => harness.db.query(
        `INSERT INTO projects (id, user_id, opportunity_id, decision_id, title, build_type, stake_deadline_at)
         VALUES ('prj_i6_dup', $1, $2, $3, 'dup', 'TOOL', NOW() + INTERVAL '7 days')`,
        [USER, OPP, project.decision_id]
      ),
      (error: any) => error?.code === '23505' && String(error?.constraint ?? '') === 'idx_projects_decision',
      '同一个 decision_id 被允许挂两个项目'
    );
  });

  it('被拒绝的 GO 连配额一起回滚，不留下凭空出现的授权', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    const before = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM decisions WHERE opportunity_id = $1`,
      [OPP_SHARED]
    );

    // 这条机会没有槽位行（夹具故意不建），所以占槽那一步必然失败。
    await expectError(
      () => DecisionService.goAndExport(USER_OTHER, {
        opportunityId: OPP_SHARED,
        archetype: 'TOOL',
        verdictId: VERDICT_SHARED,
      }),
      400,
      '对没有该形态的机会 GO'
    );

    const after = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM decisions WHERE opportunity_id = $1`,
      [OPP_SHARED]
    );
    assert.strictEqual(
      after.rows[0].count,
      before.rows[0].count,
      '被拒绝的 GO 仍然留下了决策行 —— 伪造授权的路径又回来了'
    );

    // 配额也必须回滚：扣了额度却没占到槽，等于白吃一次月度额度。
    const counter = await harness.db.query<{ used: number }>(
      `SELECT used FROM usage_counters
        WHERE user_id = $1 AND feature = 'atomic_go_export_monthly'`,
      [USER_OTHER]
    );
    assert.strictEqual(counter.rows.length, 0, '被回滚的 GO 仍然消耗了配额');
  });

  it('裁决不属于这条机会时无法 GO', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    await expectError(
      () => DecisionService.goAndExport(USER_OTHER, {
        opportunityId: OPP_SHARED,
        archetype: 'TOOL',
        verdictId: VERDICT_V1,
      }),
      409,
      '跨机会引用裁决 GO'
    );
    await expectError(
      () => DecisionService.goAndExport(USER_OTHER, {
        opportunityId: OPP,
        archetype: 'TOOL',
        verdictId: 'vdt_does_not_exist',
      }),
      409,
      '引用不存在的裁决 GO'
    );
  });

  it('决策行不可改写，但仍可删除', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    // 用一条**没有项目**的 GO 决策。2026-10 起，落过项的决策删不得：删它级联到
    // `projects`，而那条项目被 `slot_claims.project_id` 的外键指着——槽位认领是
    // "这一次额度花在哪、占了哪个坑"的凭据，跟着项目一起消失会让
    // `opportunity_slots.claimed` 静默漂移（I11）。本条测的是追加写触发器对
    // DELETE 的放行，不需要经过那条路径。
    const decision = await DecisionService.record(USER_OTHER, {
      opportunityId: OPP,
      verdictId: VERDICT_V2,
      decision: 'GO',
    });

    await assert.rejects(
      () => harness.db.query(`UPDATE decisions SET reasons = '{OTHER}' WHERE id = $1`, [decision.id]),
      (error: any) => error?.code === '0A000',
      '决策行被允许改写'
    );

    // DELETE 必须放行。注意这**不是**在保护账号注销 —— 注销是软删
    // （admin.service.ts 把 users.status 置为 DELETED），应用代码里没有
    // `DELETE FROM users`。放行 DELETE 是为了保住测试夹具的清理路径，以及
    // 将来真正的擦除请求（硬删）不至于被永久堵死。
    await harness.db.query(`DELETE FROM decisions WHERE id = $1`, [decision.id]);
    const remaining = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM decisions WHERE id = $1`,
      [decision.id]
    );
    assert.strictEqual(remaining.rows[0].count, 0, '决策行删不掉');

    // 与之相对：落过项的决策不能删。这不是限制，而是**记录完整性**——删它会级联
    // 掉项目，而那条项目正被槽位认领指着。静默级联会让 claimed 与真值分家。
    const claimed = (
      await harness.db.query<{ decision_id: string }>(
        `SELECT decision_id FROM projects WHERE user_id = $1 AND opportunity_id = $2`,
        [USER, OPP]
      )
    ).rows[0];
    assert.ok(claimed, '夹具里应当有一条已立项的项目');
    await assert.rejects(
      () => harness.db.query(`DELETE FROM decisions WHERE id = $1`, [claimed.decision_id]),
      (error: any) => error?.code === '23503' && String(error?.constraint ?? '') === 'slot_claims_project_id_fkey',
      '落过项的决策被允许删除 —— 槽位认领会跟着静默消失'
    );
  });
});
