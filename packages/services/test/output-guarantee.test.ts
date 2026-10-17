import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

const harness = makeDisposableDb('emeradar_output_guarantee_test');

async function verdictRow(id: string, verdict: string, obsDate: string) {
  await harness.db.query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, $2, $1, 'TRACKED', '2026-01-01') ON CONFLICT (id) DO NOTHING`,
    [id, id.replace(/_/g, '-')]
  );
  await harness.db.query(
    `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, confidence, prev_hash, row_hash, hash_version,
       raw_verdict, explanation, d_band, m_band, w_band)
     VALUES ($1, $2, $3, '1.0', $4, 'EARLY_WINDOW', 7000, 6000, 5000, 'HIGH', $5, $6, 2,
       $4, '{"rulesTriggered":[]}'::jsonb, 'HIGH', 'HIGH', 'HIGH')`,
    [`vdt_${id}_${obsDate}`, id, obsDate, verdict, '0'.repeat(64), `vdt_${id}_${obsDate}`.padEnd(64, '0')]
  );
}

async function sub(id: string, endSql: string, plan = 'PRO') {
  await harness.db.query(
    `INSERT INTO users (id, email, display_name, role, tier, status) VALUES ($1, $2, $1, 'USER', 'PRO', 'ACTIVE')`,
    [id, `${id}@emeradar.test`]
  );
  await harness.db.query(
    `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start, current_period_end, entitlements_snapshot)
     VALUES ($1, $2, $3, 'ACTIVE', NOW(), ${endSql}, '{}'::jsonb)`,
    [`sub_${id}`, id, plan]
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await sub('usr_og_month', "NOW() + INTERVAL '10 days'");
  await sub('usr_og_life', "TIMESTAMPTZ '9999-12-31 23:59:59+00'");
});
after(async () => {
  await harness.teardown();
});

describe('兜底承诺', () => {
  it('不触发：账本在窗口内没有任何行（管线没跑不是零产出）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const result = await harness.services.OutputGuaranteeService.check('2026-06-30');
    assert.strictEqual(result.triggered, false);
  });

  it('不触发：窗口内有合格 BUILD_NOW 行', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await verdictRow('opp_og_a', 'BUILD_NOW', '2026-06-25');
    const result = await harness.services.OutputGuaranteeService.check('2026-06-30');
    assert.strictEqual(result.triggered, false);
  });

  it('连续 14 天零合格：周期订阅延长 7 天，终身版不动，同一窗口只补偿一次', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await verdictRow('opp_og_b', 'WATCH', '2026-08-10');
    const before = await harness.db.query<any>(
      `SELECT user_id, current_period_end FROM subscriptions ORDER BY user_id`
    );
    const monthBefore = before.rows.find((r: any) => r.user_id === 'usr_og_month').current_period_end;

    const first = await harness.services.OutputGuaranteeService.check('2026-08-14');
    assert.strictEqual(first.triggered, true);
    assert.strictEqual(first.subscriptionsExtended, 1);

    const after = await harness.db.query<any>(`SELECT user_id, current_period_end FROM subscriptions`);
    const monthAfter = after.rows.find((r: any) => r.user_id === 'usr_og_month').current_period_end;
    assert.strictEqual(monthAfter.getTime() - monthBefore.getTime(), 7 * 86_400_000);
    const lifeAfter = after.rows.find((r: any) => r.user_id === 'usr_og_life').current_period_end;
    assert.strictEqual(lifeAfter.getUTCFullYear(), 9999, '终身版哨兵值被改动了');

    const again = await harness.services.OutputGuaranteeService.check('2026-08-14');
    assert.strictEqual(again.alreadyGranted, true);
    assert.strictEqual(again.subscriptionsExtended, 0);
    const final = await harness.db.query<any>(`SELECT current_period_end FROM subscriptions WHERE user_id = 'usr_og_month'`);
    assert.strictEqual(final.rows[0].current_period_end.getTime(), monthAfter.getTime(), '同一窗口被重复补偿');
  });
});
