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
         'HIGH', 'LIGHTWEIGHT_TOOL', 'WEEKEND', 'fixture', 'fixture', NOW())`,
      [opportunityId, slug]
    );
  }

  // 同一机会下的两条裁决 —— "决策锚定的是哪一条"才有可判定的对象。
  for (const [id, opportunityId, obsDate] of [
    [VERDICT_V1, OPP, '2026-10-05'],
    [VERDICT_V2, OPP, '2026-10-06'],
    [VERDICT_OTHER, OPP_OTHER, '2026-10-06'],
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

  it('项目引用 GO 决策落库，并带上报告', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService, ProjectService } = harness.services;

    const decision = await DecisionService.record(USER, {
      opportunityId: OPP,
      verdictId: VERDICT_V1,
      decision: 'GO',
    });
    const project = await ProjectService.createProject(USER, {
      opportunityId: OPP,
      decisionId: decision.id,
      title: 'Decision Traceability Project',
    });
    assert.strictEqual(project.decision_id, decision.id, '项目没有引用那条 GO');
    assert.strictEqual(project.opportunity_id, OPP);
  });

  it('同一条 GO 不能立出第二个项目（不变量 I6）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService, ProjectService } = harness.services;

    const decision = await DecisionService.record(USER, {
      opportunityId: OPP,
      verdictId: VERDICT_V1,
      decision: 'GO',
    });

    // 这条决策在上一个用例里已经立过项了。
    await expectError(
      () => ProjectService.createProject(USER, { opportunityId: OPP, decisionId: decision.id, title: 'Second' }),
      409,
      '同一条决策二次立项'
    );

    const projects = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects WHERE decision_id = $1`,
      [decision.id]
    );
    assert.strictEqual(projects.rows[0].count, 1, '一条决策下的项目数不为 1');
  });

  it('缺少 decisionId 时拒绝立项，而不是替用户伪造一条 GO', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { ProjectService } = harness.services;

    const before = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM decisions WHERE opportunity_id = $1`,
      [OPP]
    );

    await expectError(
      () => ProjectService.createProject(USER, { opportunityId: OPP, decisionId: '', title: 'X' }),
      409,
      '无 decisionId 立项'
    );

    const after = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM decisions WHERE opportunity_id = $1`,
      [OPP]
    );
    assert.strictEqual(
      after.rows[0].count,
      before.rows[0].count,
      '被拒绝的立项仍然留下了决策行 —— 伪造 GO 的路径又回来了'
    );
  });

  it('不能借他人的决策立项，也不能用 PASS 立项', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService, ProjectService } = harness.services;

    const go = await DecisionService.record(USER, {
      opportunityId: OPP,
      verdictId: VERDICT_V1,
      decision: 'GO',
    });
    const pass = await DecisionService.record(USER, {
      opportunityId: OPP,
      verdictId: VERDICT_V2,
      decision: 'PASS',
      reasons: ['OTHER'],
    });

    await expectError(
      () => ProjectService.createProject(USER_OTHER, { opportunityId: OPP, decisionId: go.id, title: 'X' }),
      403,
      '引用他人决策立项'
    );
    await expectError(
      () => ProjectService.createProject(USER, { opportunityId: OPP, decisionId: pass.id, title: 'X' }),
      403,
      '用 PASS 决策立项'
    );
  });

  it('决策行不可改写，但仍可删除', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { DecisionService } = harness.services;

    const decision = await DecisionService.record(USER, {
      opportunityId: OPP,
      verdictId: VERDICT_V1,
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
  });
});
