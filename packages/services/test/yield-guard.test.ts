import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/** 产出守卫（05 §7.2）：断流只产生告警，不产生任何配置变更。 */
const harness = makeDisposableDb('emeradar_yield_guard_test');
const ADMIN = 'usr_yield_admin';

async function seedVerdict(id: string, verdict: string, obsDate: string) {
  const { query } = harness.db;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, $2, $3, 'TRACKED', '2026-01-01') ON CONFLICT (id) DO NOTHING`,
    [id, id.replace(/_/g, '-'), id]
  );
  await query(
    `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
       lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
       prev_hash, row_hash, hash_version, raw_verdict, explanation, d_band, m_band, w_band)
     VALUES ($1, $2, $3, '1.0', $4, 'EARLY_WINDOW', 7000, 6000, 5000, 'HIGH', $5, $6, 2,
       $4, '{"rulesTriggered":[]}'::jsonb, 'HIGH', 'HIGH', 'HIGH')`,
    [`vdt_${id}_${obsDate}`, id, obsDate, verdict, '0'.repeat(64), `vdt_${id}_${obsDate}`.padEnd(64, '0')]
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await harness.db.query(
    `INSERT INTO users (id, email, display_name, role, tier, status)
     VALUES ($1, 'yield-admin@emeradar.test', 'admin', 'ADMIN', 'PRO', 'ACTIVE')`,
    [ADMIN]
  );
});

after(async () => {
  await harness.teardown();
});

describe('产出守卫', () => {
  it('7 天无新增 BUILD_NOW/EARLY_BET：只发 Admin 告警，不改任何配置', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { YieldGuardService } = harness.services;
    const { query } = harness.db;

    await seedVerdict('opp_y_old', 'BUILD_NOW', '2026-03-01');
    const configsBefore = await query(`SELECT COUNT(*)::int AS n FROM scoring_configs`).catch(() => null);

    const result = await YieldGuardService.check('2026-06-01');
    assert.strictEqual(result.floorBreached, true);
    assert.deepStrictEqual(result.alertsRaised.includes('yield.floor_breached'), true);

    const notes = await query(`SELECT user_id FROM notifications WHERE id LIKE 'ntf_yield_floor_%'`);
    assert.strictEqual(notes.rows.length, 1);
    assert.strictEqual(notes.rows[0].user_id, ADMIN);

    const audit = await query(`SELECT 1 FROM audit_log WHERE action = 'yield.floor_breached'`);
    assert.strictEqual(audit.rows.length, 1);

    if (configsBefore) {
      const after = await query(`SELECT COUNT(*)::int AS n FROM scoring_configs`);
      assert.strictEqual(after.rows[0].n, configsBefore.rows[0].n, '守卫不得产生新配置');
    }

    // 同一天重跑不重复通知。
    await YieldGuardService.check('2026-06-01');
    const again = await query(`SELECT 1 FROM notifications WHERE id LIKE 'ntf_yield_floor_%'`);
    assert.strictEqual(again.rows.length, 1);
  });

  it('窗口内有新增时不触发下限告警', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { YieldGuardService } = harness.services;
    await seedVerdict('opp_y_new', 'EARLY_BET', '2026-06-10');
    const result = await YieldGuardService.check('2026-06-12');
    assert.strictEqual(result.floorBreached, false);
    assert.strictEqual(result.newPublishedInWindow, 1);
  });
});
