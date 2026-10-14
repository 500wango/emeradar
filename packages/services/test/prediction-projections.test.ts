import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDailyLedger,
  GENESIS_PREV_HASH,
  type DailyLedgerRecord,
  type PredictionSpec,
  type VerdictRowDataV1,
  type VerdictRowDataV2,
  type VerdictRowDataV3,
} from '@emeradar/ledger';
import { makeDisposableDb } from './helpers/disposable-db';

// Verdicts are append-only; never insert projection fixtures into the developer database.
const harness = makeDisposableDb('emeradar_prediction_projection');
const USER = 'usr_prediction_projection';
const DAY = '2026-09-17';
const ids = {
  spec: 'opp_projection_v3_spec',
  none: 'opp_projection_v3_none',
  v2: 'opp_projection_v2',
  v1: 'opp_projection_v1',
} as const;
// Deliberately unlike the active evaluator: the report must cite the sealed row,
// not an in-memory default or the currently configured evaluation criteria.
const sealedSpec: PredictionSpec = {
  criteriaVersion: 'ev-projection-historic',
  horizons: [90, 30],
  target: 'market_formed',
};

function base(id: string, verdict: 'BUILD_NOW' | 'WATCH'): VerdictRowDataV1 {
  return {
    opportunityId: id,
    obsDate: DAY,
    scoringConfigVersion: 'sc-1.0.0',
    verdict,
    lifecycle: 'EARLY_WINDOW',
    dBasisPoints: 8500,
    mBasisPoints: 7700,
    wBasisPoints: 8100,
    confidence: 'HIGH',
    inputSnapshotIds: [`snp_${id}`],
    citedEvidenceIds: [],
  };
}

function v2(row: VerdictRowDataV1): VerdictRowDataV2 {
  return {
    ...row,
    rawVerdict: row.verdict,
    flags: [],
    explanation: {
      dReason: 'Observed demand.',
      mReason: 'Observed payment evidence.',
      wReason: 'Observed SERP gap.',
      verdictReason: 'Recorded decision.',
      rulesTriggered: ['RULE_BUILD_NOW'],
    },
    featuresHash: 'a'.repeat(64),
    dBand: 'HIGH',
    mBand: 'HIGH',
    wBand: 'HIGH',
  };
}

describe('v3 prediction specification on report and opportunity detail projections', () => {
  before(async () => {
    await harness.setup();
    if (!harness.available) return;

    const { query } = harness.db;
    await query(
      `INSERT INTO users (id, email, display_name, role, status, tier)
       VALUES ($1, $2, 'Projection Tester', 'ADMIN', 'ACTIVE', 'FREE')`,
      [USER, 'prediction-projection@example.test']
    );
    for (const id of Object.values(ids)) {
      await query(
        `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
         VALUES ($1, $1, $1, 'TRACKED', $2::date)`,
        [id, DAY]
      );
      await query(
        `INSERT INTO opportunity_cards (
           opportunity_id, slug, primary_query, verdict, lifecycle,
           d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
           confidence, recommended_archetype, execution_class, why_now_summary,
           top_idea, first_observed_at
         ) VALUES (
           $1, $1, $1, $2, 'EARLY_WINDOW', 8500, 7700, 8100, 'HIGH', 'HIGH', 'HIGH',
           'HIGH', 'TOOL', 'S', 'Observed evidence', 'Focused tool', $3::date
         )`,
        [id, id === ids.none ? 'WATCH' : 'BUILD_NOW', DAY]
      );
      await query(
        `INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date)
         VALUES ($1, $2, $3::date)`,
        [`snp_${id}`, id, DAY]
      );
    }

    for (const [oppId, suffix] of [[ids.spec, 'spec'], [ids.v2, 'v2'], [ids.v1, 'v1']] as const) {
      await query(`INSERT INTO queries (id, query_text) VALUES ($1, $2)`,
        [`qry_projection_${suffix}`, `prediction projection ${suffix}`]);
      await query(
        `INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ($1, $2, 'PRIMARY')`,
        [oppId, `qry_projection_${suffix}`]
      );
      await query(
        `INSERT INTO serp_snapshots (id, query_id, obs_date) VALUES ($1, $2, $3::date)`,
        [`srp_projection_${suffix}`, `qry_projection_${suffix}`, DAY]
      );
      await query(
        `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title)
         VALUES ($1, 1, 'https://example.test', 'example.test', 'Observed SERP result')`,
        [`srp_projection_${suffix}`]
      );
    }

    const records: DailyLedgerRecord[] = [
      { opportunityId: ids.spec, data: { ...v2(base(ids.spec, 'BUILD_NOW')), predictionSpec: sealedSpec }, hashVersion: 3 },
      { opportunityId: ids.none, data: { ...v2(base(ids.none, 'WATCH')), predictionSpec: null }, hashVersion: 3 },
      { opportunityId: ids.v2, data: v2(base(ids.v2, 'BUILD_NOW')), hashVersion: 2 },
      { opportunityId: ids.v1, data: base(ids.v1, 'BUILD_NOW'), hashVersion: 1 },
    ];
    const ledger = generateDailyLedger(DAY, records, GENESIS_PREV_HASH, GENESIS_PREV_HASH);
    for (const row of ledger.hashedRows) {
      const data = row.data;
      const basis = 'rawVerdict' in data ? data as VerdictRowDataV2 : null;
      const spec = 'predictionSpec' in data ? (data as VerdictRowDataV3).predictionSpec : null;
      await query(
        `INSERT INTO verdicts (
           id, opportunity_id, obs_date, scoring_config_version, verdict, raw_verdict,
           lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
           input_snapshot_ids, cited_evidence_ids, flags, explanation, features_hash,
           hash_version, d_band, m_band, w_band, prediction_spec, prev_hash, row_hash
         ) VALUES (
           $1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20, $21::jsonb, $22, $23
         )`,
        [
          `vdt_${row.opportunityId}`, row.opportunityId, DAY, data.scoringConfigVersion,
          data.verdict, basis?.rawVerdict ?? null, data.lifecycle, data.dBasisPoints,
          data.mBasisPoints, data.wBasisPoints, data.confidence, data.inputSnapshotIds,
          data.citedEvidenceIds, basis?.flags ?? null,
          basis ? JSON.stringify(basis.explanation) : null, basis?.featuresHash ?? null,
          row.hashVersion, basis?.dBand ?? null, basis?.mBand ?? null, basis?.wBand ?? null,
          spec === null ? null : JSON.stringify(spec), row.prevHash, row.rowHash,
        ]
      );
    }
  });

  after(async () => { await harness.teardown(); });

  it('returns the sealed v3 spec and explicit null in detail, distinguishable from legacy rows', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { OpportunityService } = harness.services;
    const spec = (await OpportunityService.getOpportunityDetail(ids.spec)).latestVerdict;
    assert.equal(spec.hash_version, 3);
    assert.deepEqual(spec.prediction_spec, sealedSpec);
    assert.equal(spec.row_hash.length, 64);

    const none = (await OpportunityService.getOpportunityDetail(ids.none)).latestVerdict;
    assert.equal(none.hash_version, 3);
    assert.ok(Object.hasOwn(none, 'prediction_spec'), 'v3 null is an explicit no-prediction value');
    assert.equal(none.prediction_spec, null);

    for (const [id, version] of [[ids.v2, 2], [ids.v1, 1]] as const) {
      const old = (await OpportunityService.getOpportunityDetail(id)).latestVerdict;
      assert.equal(old.hash_version, version);
      assert.equal(old.prediction_spec, null, 'old rows never recorded a prediction spec');
    }
  });

  it('persists the sealed spec in generated and cached report JSON and exports', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { ReportService } = harness.services;
    const generated = await ReportService.getOrGenerateReport(ids.spec, USER, 'en-US');
    assert.equal(generated.cached, false);
    assert.equal(generated.data.section1.decisionBasis.hashVersion, 3);
    assert.deepEqual(generated.data.section1.decisionBasis.predictionSpec, sealedSpec);
    assert.match(generated.markdown, /ev-projection-historic/);
    assert.ok(generated.markdown.includes('market\\_formed'));

    const stored = await harness.db.query<{ content: any; content_markdown: string }>(
      `SELECT content, content_markdown FROM opportunity_reports WHERE id = $1`, [generated.reportId]
    );
    assert.deepEqual(stored.rows[0].content.section1.decisionBasis.predictionSpec, sealedSpec);
    assert.match(stored.rows[0].content_markdown, /ev-projection-historic/);

    const cached = await ReportService.getOrGenerateReport(ids.spec, USER, 'en-US');
    assert.equal(cached.cached, true);
    assert.equal(cached.reportId, generated.reportId);
    assert.deepEqual(cached.data.section1.decisionBasis.predictionSpec, sealedSpec);

    const json = await ReportService.exportReportFormat(generated.reportId, 'json', USER);
    assert.deepEqual(JSON.parse(json.content).section1.decisionBasis.predictionSpec, sealedSpec);
    const md = await ReportService.exportReportFormat(generated.reportId, 'markdown', USER);
    assert.match(md.content, /ev-projection-historic/);
    const html = await ReportService.exportReportFormat(generated.reportId, 'html', USER);
    assert.match(html.content, /ev-projection-historic/);
  });

  it('does not invent a spec for a v2 report or add it to reduced feed and compare cards', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { ReportService, OpportunityService } = harness.services;
    const report = await ReportService.getOrGenerateReport(ids.v2, USER, 'en-US');
    assert.equal(report.data.section1.decisionBasis.hashVersion, 2);
    assert.ok(!Object.hasOwn(report.data.section1.decisionBasis, 'predictionSpec'));
    assert.doesNotMatch(report.markdown, /ev-projection-historic/);

    const feed = await OpportunityService.listFeedCards({ limit: 10 });
    assert.equal(feed.total, 4);
    for (const item of feed.items) {
      assert.ok(!Object.hasOwn(item, 'predictionSpec'));
      assert.ok(!Object.hasOwn(item, 'prediction_spec'));
    }
    const compare = await OpportunityService.compareOpportunities([ids.spec, ids.v2]);
    for (const item of compare) {
      assert.ok(!Object.hasOwn(item, 'predictionSpec'));
      assert.ok(!Object.hasOwn(item, 'prediction_spec'));
    }
  });
});
