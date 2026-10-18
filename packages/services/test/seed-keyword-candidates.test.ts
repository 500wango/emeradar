import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';
import { dedupeKey, isCandidateKeyword } from '../src/pipeline/seed-keyword-candidates';

const harness = makeDisposableDb('emeradar_seed_keywords_test');

before(async () => {
  await harness.setup();
});
after(async () => {
  await harness.teardown();
});

const s = (keyword: string, mainIntent: string | null = 'transactional') => ({
  keyword,
  searchVolume: 1000,
  keywordDifficulty: 10,
  mainIntent,
});

describe('keyword seed entry filter', () => {
  it('drops the bare seed, brand / navigational terms and non-ASCII noise', () => {
    assert.strictEqual(isCandidateKeyword(s('invoice generator'), 'generator'), true);
    assert.strictEqual(isCandidateKeyword(s('generator'), 'generator'), false);
    assert.strictEqual(isCandidateKeyword(s('youtube thumbnail generator'), 'generator'), false);
    assert.strictEqual(isCandidateKeyword(s('qr code generator', 'navigational'), 'generator'), false);
    assert.strictEqual(isCandidateKeyword(s('générateur generator'), 'generator'), false);
  });

  it('treats plural, hyphen and word-order variants as one demand', () => {
    assert.strictEqual(dedupeKey('barcode generator'), dedupeKey('barcodes generator'));
    assert.strictEqual(dedupeKey('barcode generator'), dedupeKey('barcode-generator'));
    assert.strictEqual(dedupeKey('generator barcode'), dedupeKey('barcode generator'));
    assert.notStrictEqual(dedupeKey('barcode generator'), dedupeKey('qr code generator'));
  });
});

describe('seedKeywordCandidates', () => {
  it('skips without credentials and writes nothing', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const result = await harness.services.seedKeywordCandidates('2026-10-18', null);
    assert.strictEqual(result.skipped, true);
    const rows = await harness.db.query(`SELECT 1 FROM opportunities`);
    assert.strictEqual(rows.rows.length, 0);
  });

  it('creates tier-A candidates once per demand, keeps volume out of snapshots, and records spend', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    const fake = {
      suggest: async () => [s('invoice generator'), s('invoices generator'), s('youtube intro generator'), s('fantasy name generator')],
    } as any;

    const first = await harness.services.seedKeywordCandidates('2026-10-18', fake);
    assert.strictEqual(first.created, 2, 'the plural variant and the brand term are not new candidates');

    const rows = await query<{ query_text: string; tier: string; status: string; discovery_source: string }>(
      `SELECT q.query_text, q.tier, o.status, o.discovery_source
         FROM opportunities o
         JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
         JOIN queries q ON q.id = oq.query_id
        ORDER BY q.query_text`
    );
    assert.deepStrictEqual(rows.rows.map((r) => [r.query_text, r.tier, r.status, r.discovery_source]), [
      ['fantasy name generator', 'A', 'CANDIDATE', 'KEYWORD_SEED'],
      ['invoice generator', 'A', 'CANDIDATE', 'KEYWORD_SEED'],
    ]);
    const snapshots = await query(`SELECT 1 FROM opportunity_snapshots`);
    assert.strictEqual(snapshots.rows.length, 0, 'volume must not reach any scoring input');
    const cards = await query<{ d_band: string; w_band: string }>(`SELECT d_band, w_band FROM opportunity_cards`);
    assert.ok(cards.rows.every((c) => c.d_band === 'INSUFFICIENT' && c.w_band === 'INSUFFICIENT'));

    const spend = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM cost_ledger WHERE source_id = 'src_keyword_seed'`);
    assert.strictEqual(spend.rows[0].n, first.seeds.length);

    // 同一天重跑：同一组种子、已存在的需求，不再新增。
    const again = await harness.services.seedKeywordCandidates('2026-10-18', fake);
    assert.strictEqual(again.created, 0);
  });

  it('counts a failed seed request as a failure, not as zero suggestions', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const result = await harness.services.seedKeywordCandidates('2026-10-19', { suggest: async () => null } as any);
    assert.strictEqual(result.failures, result.seeds.length);
    assert.strictEqual(result.created, 0);
  });
});

describe('attachAutocompleteClusters', () => {
  it('adds suggestions to the observed opportunity cluster instead of spawning candidates', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    const opp = await query<{ opportunity_id: string; query_id: string }>(
      `SELECT oq.opportunity_id, oq.query_id FROM opportunity_queries oq
         JOIN queries q ON q.id = oq.query_id WHERE q.query_text = 'invoice generator'`
    );
    const { opportunity_id, query_id } = opp.rows[0];
    await query(
      `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions, depth)
       VALUES ($1, '2026-10-18', $2, 1)`,
      [query_id, ['invoice generator', 'invoice generator free', 'invoice generator pdf']]
    );
    const before = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM opportunities`);

    const attached = await harness.services.attachAutocompleteClusters('2026-10-18');
    assert.strictEqual(attached, 2, 'the primary query itself is not its own cluster member');

    const after = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM opportunities`);
    assert.strictEqual(after.rows[0].n, before.rows[0].n, 'no new candidate opportunities');
    const cluster = await query<{ query_text: string; tier: string }>(
      `SELECT q.query_text, q.tier FROM opportunity_queries oq JOIN queries q ON q.id = oq.query_id
        WHERE oq.opportunity_id = $1 AND oq.role = 'CLUSTER' ORDER BY q.query_text`,
      [opportunity_id]
    );
    assert.deepStrictEqual(cluster.rows.map((r) => [r.query_text, r.tier]), [
      ['invoice generator free', 'C'],
      ['invoice generator pdf', 'C'],
    ]);
    assert.strictEqual(await harness.services.attachAutocompleteClusters('2026-10-18'), 0, 'idempotent');
  });
});
