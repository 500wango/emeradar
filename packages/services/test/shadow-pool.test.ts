import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Phase 2 Shadow Pool：分层抽样、T+30/60/90 回访、加权漏判统计。
 *
 * 关键不是“抽了多少”，而是**按拒绝原因分层**：M_BLOCKED 与 M_NO_PRICING 的漏判
 * 机制不同，混在一起算出来的比例没有意义。
 */
const harness = makeDisposableDb('emeradar_shadow_pool_test');

async function seedRejected(id: string, reasonCode: string, axis: string, surface: string) {
  const { query } = harness.db;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, $2, $3, 'CANDIDATE', CURRENT_DATE)`,
    [id, id.replace(/_/g, '-'), surface]
  );
  await query(
    `INSERT INTO opportunity_rejections (opportunity_id, obs_date, axis, reason_code, rule_version)
     VALUES ($1, CURRENT_DATE - 1, $2, $3, 'sc-1.3.0')`,
    [id, axis, reasonCode]
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  for (let i = 0; i < 6; i++) {
    await seedRejected(`opp_shadow_m1_${i}`, 'M_INFRA_ONLY', 'M', `pdf tool ${i}`);
  }
  for (let i = 0; i < 4; i++) {
    await seedRejected(`opp_shadow_m2_${i}`, 'M_BLOCKED_WAF', 'M', `csv tool ${i}`);
  }
  await seedRejected('opp_shadow_d1', 'D_INSUFFICIENT', 'D', 'helper noun');
});

after(async () => {
  await harness.teardown();
});

describe('Phase 2 Shadow Pool', () => {
  it('按拒绝原因分层抽样，并排 T+30/60/90 三个回访', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { sampleShadowPool } = harness.services;
    const result = await sampleShadowPool('2026-10-19');
    assert.ok(result.sampled >= 2, '至少应抽到两种拒绝原因');
    assert.strictEqual(result.checkpointsScheduled, result.sampled * 3);

    const strata = result.byStratum.filter((row: any) => row.sampled > 0).map((row: any) => row.stratum).sort();
    assert.deepStrictEqual(strata, ['D_INSUFFICIENT', 'M_BLOCKED_WAF', 'M_INFRA_ONLY']);

    // 幂等：同一天重跑不产生新样本。
    const again = await sampleShadowPool('2026-10-19');
    assert.strictEqual(again.sampled, 0);
  });

  it('DATA_* 拒绝不抽样（数据不足不是市场判断）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ('opp_shadow_data', 'shadow-data', 'data', 'CANDIDATE', CURRENT_DATE)`
    );
    await query(
      `INSERT INTO opportunity_rejections (opportunity_id, obs_date, axis, reason_code, rule_version)
       VALUES ('opp_shadow_data', CURRENT_DATE - 1, 'DATA', 'DATA_BASELINE_PERIOD', 'sc-1.3.0')`
    );
    const rows = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM shadow_pool_samples WHERE opportunity_id = 'opp_shadow_data'`
    );
    assert.strictEqual(rows.rows[0].count, 0);
  });

  it('到期回访被抓取，漏判被计入分层统计', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { pendingCheckpoints, evaluateShadowOutcome, captureCheckpoint, shadowPoolStats } = harness.services;
    const { query } = harness.db;

    // 让 T+30 到期：把 due_date 提前到过去。
    await query(`UPDATE shadow_checkpoints SET due_date = CURRENT_DATE - 1 WHERE horizon_days = 30`);
    const pending = await pendingCheckpoints('2026-10-19');
    assert.ok(pending.length > 0);

    // 其中一条被拒的机会现在出现了两个公开付费档位 → 漏判。
    const target = pending[0];
    await query(
      `INSERT INTO evidence (opportunity_id, evidence_class, source_type, domain, title, snippet, payload)
       VALUES ($1,'OBSERVED','PAID_TIER_OBSERVED','a.example','Priced','s','{}'),
              ($1,'OBSERVED','PAID_TIER_OBSERVED','b.example','Priced','s','{}')`,
      [target.opportunityId]
    );
    await query(
      `INSERT INTO opportunity_cards (opportunity_id, slug, primary_query, verdict, lifecycle,
         d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band, confidence,
         recommended_archetype, execution_class, why_now_summary, top_idea, first_observed_at)
       VALUES ($1,'shadow-target','shadow target','WATCH','FORMING',5000,7000,5000,
         'MEDIUM','HIGH','MEDIUM','MEDIUM','TOOL','S','w','t',NOW())
       ON CONFLICT (opportunity_id) DO UPDATE SET m_band = 'HIGH'`,
      [target.opportunityId]
    );

    const outcome = await evaluateShadowOutcome(target.opportunityId);
    assert.strictEqual(outcome.outcome, 'CANDIDATE_BECAME_OPPORTUNITY');
    await captureCheckpoint(target.checkpointId, outcome.outcome, outcome.evidence);

    const stats = await shadowPoolStats();
    assert.ok(stats.some((row: any) => row.becameOpportunity >= 1), '漏判没有被统计');
    const withCaptures = (stats as any[]).filter((row) => row.captured > 0);
    assert.ok(withCaptures.length > 0);
    for (const row of withCaptures) assert.strictEqual(typeof row.weightedFnr, 'number');
  });

  it('没有回访样本时 FNR 为 null，不显示成 0', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { shadowPoolStats } = harness.services;
    const stats = await shadowPoolStats();
    for (const row of stats as any[]) {
      if (row.captured === 0) assert.strictEqual(row.weightedFnr, null);
    }
  });
});
