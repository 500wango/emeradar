import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Free 层 feed_selected_weekly（13 §3.2、15 §3，30 Q10）。
 * 资格只有两条：槽位满额，或当前为 WINDOW_CLOSING。空槽的 BUILD_NOW 任何情况下都不入选。
 */
const harness = makeDisposableDb('emeradar_weekly_sel_test');

const OPP_OPEN = 'opp_wk_open'; // BUILD_NOW，仍有空槽：永不入选
const OPP_FULL = 'opp_wk_full'; // 槽位满额
const OPP_CLOSING = 'opp_wk_closing'; // WINDOW_CLOSING

async function seed(id: string, verdict: string, capacity: number, claimed: number, mBand = 'HIGH') {
  const { query } = harness.db;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, $2, $3, 'TRACKED', '2026-01-01')`,
    [id, id.replace(/_/g, '-'), `${id} title`]
  );
  await query(
    `INSERT INTO opportunity_slots (opportunity_id, archetype, capacity, claimed)
     VALUES ($1, 'TOOL', $2, $3)`,
    [id, capacity, claimed]
  );
  await query(
    `INSERT INTO opportunity_cards (
       opportunity_id, slug, primary_query, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
       confidence, recommended_archetype, execution_class, why_now_summary,
       top_idea, first_observed_at
     ) VALUES ($1, $2, $1, $3, 'EARLY_WINDOW',
       7000, 6000, 5000, 'HIGH', $4, 'HIGH',
       'HIGH', 'TOOL', 'S', 'fixture', 'fixture', NOW())`,
    [id, id.replace(/_/g, '-'), verdict, mBand]
  );
  await query(
    `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
       lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
       prev_hash, row_hash)
     VALUES ($1, $2, CURRENT_DATE, '1.0', $3, 'EARLY_WINDOW',
       7000, 6000, 5000, 'HIGH', $4, $5)`,
    [`vdt_${id}`, id, verdict, '0'.repeat(64), `vdt_${id}`.padEnd(64, '0')]
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await seed(OPP_OPEN, 'BUILD_NOW', 2, 0);
});

after(async () => {
  await harness.teardown();
});

describe('Free 精选：每周 1 条准实时案例', () => {
  it('只有空槽 BUILD_NOW 时不选任何案例（回退也不放宽资格）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const picked = await harness.services.WeeklySelectionService.getWeeklySelectedCase();
    assert.strictEqual(picked, null);
  });

  it('满额的机会入选，原因是 CROWDED_LOCKED，近期案例不标历史', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seed(OPP_FULL, 'BUILD_NOW', 2, 2);
    const picked = await harness.services.WeeklySelectionService.getWeeklySelectedCase();
    assert.ok(picked);
    assert.strictEqual(picked.opportunityId, OPP_FULL);
    assert.strictEqual(picked.eligibleReason, 'CROWDED_LOCKED');
    assert.strictEqual(picked.historical, false);
  });

  it('7 天内没有新案例时回退到历史案例并标注', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const future = new Date(Date.now() + 10 * 86_400_000);
    const picked = await harness.services.WeeklySelectionService.getWeeklySelectedCase(future);
    assert.ok(picked);
    assert.strictEqual(picked.opportunityId, OPP_FULL);
    assert.strictEqual(picked.historical, true);
  });

  it('M 轴 INSUFFICIENT 的关窗机会不入选', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seed(OPP_CLOSING, 'WINDOW_CLOSING', 2, 0, 'INSUFFICIENT');
    const picked = await harness.services.WeeklySelectionService.getWeeklySelectedCase();
    assert.ok(picked);
    assert.notStrictEqual(picked.opportunityId, OPP_CLOSING);
  });
});
