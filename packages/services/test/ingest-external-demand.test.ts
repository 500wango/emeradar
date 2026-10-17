import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

const harness = makeDisposableDb('emeradar_ingest_ext_demand_test');

before(async () => {
  await harness.setup();
});
after(async () => {
  await harness.teardown();
});

describe('ingestExternalDemand', () => {
  it('skips and writes nothing when no credentials are configured', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { ingestExternalDemand } = harness.services;
    const result = await ingestExternalDemand('2026-06-01', null);
    assert.strictEqual(result.skipped, true);
    const rows = await harness.db.query(`SELECT 1 FROM external_demand_observations`);
    assert.strictEqual(rows.rows.length, 0, 'a skipped run must not write placeholder values');
  });

  it('writes only the pending episodes primary query, and counts failed requests', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { ingestExternalDemand } = harness.services;
    const { query } = harness.db;
    await query(`INSERT INTO opportunities (id, slug, title, status, first_observed_date) VALUES ('opp_ing', 'opp-ing', 't', 'TRACKED', '2026-01-01')`);
    await query(`INSERT INTO queries (id, query_text) VALUES ('qry_ing', 'invoice generator')`);
    await query(`INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ('opp_ing', 'qry_ing', 'PRIMARY')`);
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict, lifecycle,
         d_basis_points, m_basis_points, w_basis_points, confidence, prev_hash, row_hash, hash_version,
         raw_verdict, explanation, d_band, m_band, w_band)
       VALUES ('vdt_ing', 'opp_ing', '2026-05-01', '1.0', 'BUILD_NOW', 'EARLY_WINDOW', 7000, 6000, 5000, 'HIGH',
         $1, $2, 2, 'BUILD_NOW', '{"rulesTriggered":[]}'::jsonb, 'HIGH', 'HIGH', 'HIGH')`,
      ['0'.repeat(64), 'vdt_ing'.padEnd(64, '0')]
    );
    await query(
      `INSERT INTO prediction_episodes (id, verdict_id, opportunity_id, published_verdict, predicted_at,
         outcome_30d, outcome_60d, outcome_90d) VALUES ('eps_ing', 'vdt_ing', 'opp_ing', 'BUILD_NOW', '2026-05-01', 'PENDING', 'PENDING', 'PENDING')`
    );

    const fake = {
      fetchVolume: async () => new Map([['invoice generator', [{ date: '2026-05-01', value: 300 }]]]),
      fetchTrends: async () => [{ date: '2026-05-03', value: 40 }, { date: '2026-05-10', value: 55 }],
    } as any;
    const result = await ingestExternalDemand('2026-06-01', fake);
    assert.strictEqual(result.volumePoints, 1);
    assert.strictEqual(result.trendsPoints, 2);
    assert.strictEqual(result.failures, 0);

    const failing = { fetchVolume: async () => null, fetchTrends: async () => null } as any;
    const failed = await ingestExternalDemand('2026-06-02', failing);
    assert.strictEqual(failed.failures, 2);
  });
});
