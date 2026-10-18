import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { SCORING_CONFIG_VERSION } from '@emeradar/scoring';
import { makeDisposableDb } from './helpers/disposable-db';

const harness = makeDisposableDb('emeradar_recompute_test');
const OBS = '2026-06-01';

const INPUT = {
  demand: { clusterSize: 15, newQueries7d: 5, clusterGrowth30d: 0.6, expansionSlope30d: 0.4, attentionSourcesActive14d: 2, attentionGrowth14d: 0.3, historyDays: 35 },
  window: { serpWeakness: 72.5, eSpecialist30d: 0, eAuthoritative30d: 0, volatility30d: 1, serpHistoryDays: 25, recentSerpSnapshotAvailable: true },
  commercial: { band: 'HIGH', independentDomainsCount: 3, hasSubscriptionPlans: true, hasOneTimePlans: true, hasStrongNegative: false, totalScore: 8200 },
  confidence: { nIndependentSources: 3, totalEvidenceCount: 8, observedEvidenceCount: 6, medianEvidenceAgeDays: 12, historyDays: 35 },
  recommendation: {
    queryTypes: { informationalRatio: 0.3, commercialRatio: 0.4, transactionalRatio: 0.3, toolModifierRatio: 0.45, templateQueryCount: 5 },
    serpWeakness: 72.5, specialistToolCountInSerp: 2, authoritativeInTop3: false,
    commercialSummary: { band: 'HIGH', independentDomainsCount: 3, hasSubscriptionPlans: true, hasOneTimePlans: true, hasStrongNegative: false, totalScore: 8200 },
    dBand: 'HIGH', wBand: 'HIGH',
  },
};

before(async () => {
  await harness.setup();
});
after(async () => {
  await harness.teardown();
});

async function seed(
  id: string,
  input: unknown,
  ledgerOverride: Record<string, unknown> = {},
  version = SCORING_CONFIG_VERSION
) {
  const { query } = harness.db;
  const { calculateOpportunityScore } = await import('@emeradar/scoring');
  const out = input === null ? null : calculateOpportunityScore(input as any);
  const v: any = out
    ? { verdict: out.verdict, raw: out.rawVerdict, lc: out.lifecycle, d: out.dScore, m: out.mScore, w: out.wScore, db: out.dBand, mb: out.mBand, wb: out.wBand, conf: out.confidence, ...ledgerOverride }
    : { ...ledgerOverride };
  await query(`INSERT INTO opportunities (id, slug, title, status, first_observed_date) VALUES ($1, $2, $1, 'TRACKED', '2026-01-01')`, [id, id.replace(/_/g, '-')]);
  await query(`INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date, metrics, scoring_input) VALUES ($1, $2, $3, '{}', $4)`, [`snp_${id}`, id, OBS, input === null ? null : JSON.stringify(input)]);
  await query(
    `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, confidence, prev_hash, row_hash, hash_version,
       raw_verdict, explanation, d_band, m_band, w_band)
     VALUES ($1, $2, $3, $16, $4, $5, $6, $7, $8, $9, $10, $11, 2, $12, '{"rulesTriggered":[]}'::jsonb, $13, $14, $15)`,
    [`vdt_${id}`, id, OBS, v.verdict, v.lc, v.d, v.m, v.w, v.conf, '0'.repeat(64), `vdt_${id}`.padEnd(64, '0'), v.raw, v.db, v.mb, v.wb, version]
  );
}

describe('recompute (05 §8)', () => {
  it('matches when the ledger row was produced from the sealed input', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seed('opp_rc_ok', INPUT);
    const result = await harness.services.RecomputeService.recompute('opp_rc_ok', OBS);
    assert.strictEqual(result.matches, true, JSON.stringify(result.diffs));
  });

  it('reports the exact field that drifted when the ledger row disagrees', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seed('opp_rc_drift', INPUT, { d: 1234 });
    const result = await harness.services.RecomputeService.recompute('opp_rc_drift', OBS);
    assert.strictEqual(result.matches, false);
    assert.deepStrictEqual(result.diffs.map((d: any) => d.field), ['d_basis_points']);
  });

  it('refuses to recompute a snapshot without a sealed input instead of faking a diff', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seed('opp_rc_legacy', null, { verdict: 'WATCH', raw: 'WATCH', lc: 'EARLY_WINDOW', d: 0, m: 0, w: 0, db: 'LOW', mb: 'LOW', wb: 'LOW', conf: 'LOW' });
    await assert.rejects(
      () => harness.services.RecomputeService.recompute('opp_rc_legacy', OBS),
      (e: any) => e.status === 409
    );
  });

  it('按 scoring_config_version 分流：旧口径快照不被新引擎重算', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    // 旧口径（含 crowdingIndex）下 W = 8205；新公式（拥挤度退出 W）会给出 7971。
    // 用新引擎重算旧行只会得到"重算不一致"的伪差异，所以按版本拒绝。
    const legacyInput = { ...INPUT, window: { ...INPUT.window, crowdingIndex: 5 } };
    await seed('opp_rc_legacy_version', legacyInput, { w: 8205 }, 'sc-1.2.0');
    await assert.rejects(
      () => harness.services.RecomputeService.recompute('opp_rc_legacy_version', OBS),
      (e: any) => e.status === 409 && /sc-1\.2\.0/.test(e.message)
    );
  });

  it('seals the input: it cannot be rewritten once written', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await assert.rejects(
      () => harness.db.query(`UPDATE opportunity_snapshots SET scoring_input = '{}'::jsonb WHERE id = 'snp_opp_rc_ok'`),
      /sealed|0A000/
    );
  });
});

describe('recompute sampling', () => {
  it('samples deterministically and surfaces only the drifted rows', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    // percent=100 samples everything; the seeded drift row is the only mismatch.
    const first = await harness.services.RecomputeService.sample('2026-07-01', { percent: 100 });
    const second = await harness.services.RecomputeService.sample('2026-07-01', { percent: 100 });
    assert.strictEqual(first.sampled, second.sampled);
    assert.ok(first.sampled >= 2, 'rows with a sealed input must be sampled');
    assert.deepStrictEqual(first.mismatches.map((m: any) => m.opportunityId), ['opp_rc_drift']);
  });

  it('never samples rows without a sealed input', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const result = await harness.services.RecomputeService.sample('2026-07-01', { percent: 100 });
    assert.ok(!result.mismatches.some((m: any) => m.opportunityId === 'opp_rc_legacy'));
  });

  it('never samples rows written by an older scoring config', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const result = await harness.services.RecomputeService.sample('2026-07-01', { percent: 100 });
    assert.ok(!result.mismatches.some((m: any) => m.opportunityId === 'opp_rc_legacy_version'));
  });
});
