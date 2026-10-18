import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 72h STALE_DATA 的取数（04 §2、ADR-021）。
 *
 * 只覆盖"能找到/找不到最后成功快照"的边界；打分与标记由 observe/scoring 负责。
 */
const harness = makeDisposableDb('emeradar_stale_data_test');
const QRY = 'qry_stale_test';
const OPP = 'opp_stale_test';

async function seedSnapshot(id: string, obsDate: string, createdAtAgoHours: number) {
  await harness.db.query(
    `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio, depth, result_count, provider, weakness_score, created_at)
     VALUES ($1, $2, $3::date, 0.3, 10, 2, 'AISA_DATAFORSEO', 42.5, NOW() - ($4 || ' hours')::interval)`,
    [id, QRY, obsDate, String(createdAtAgoHours)]
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const { query } = harness.db;
  await query(`INSERT INTO opportunities (id, slug, title, status, first_observed_date)
               VALUES ($1, 'stale-test', 'Stale Test', 'TRACKED', CURRENT_DATE)`, [OPP]);
  await query(`INSERT INTO queries (id, query_text) VALUES ($1, 'stale test query')`, [QRY]);
  await query(
    `INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ($1, $2, 'PRIMARY')`,
    [OPP, QRY]
  );
  await seedSnapshot('srp_stale_71h', '2026-10-17', 71);
  await seedSnapshot('srp_stale_73h', '2026-10-16', 73);
  await query(
    `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title, result_type)
     VALUES ('srp_stale_71h', 1, 'https://a.example/', 'a.example', 'A', 'SPECIALIST')`
  );
  await query(
    `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions, depth, provider, created_at)
     VALUES ($1, '2026-10-17', ARRAY['stale a','stale b'], 1, 'AISA_DATAFORSEO', NOW() - INTERVAL '71 hours')`,
    [QRY]
  );
  await query(
    `INSERT INTO evidence (opportunity_id, evidence_class, source_type, domain, title, snippet, payload, observed_at)
     VALUES ($1, 'OBSERVED', 'PAID_TIER_OBSERVED', 'a.example', 'Priced', 'pricing', '{}', NOW() - INTERVAL '71 hours')`,
    [OPP]
  );
});

after(async () => {
  await harness.teardown();
});

describe('72h STALE_DATA 取数', () => {
  it('72h 内返回最后成功 SERP 快照，超过 72h 不返回', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { loadStaleSerp } = harness.services;
    const stale = await loadStaleSerp(QRY, '2026-10-18');
    assert.ok(stale);
    assert.strictEqual(stale.snapshotId, 'srp_stale_71h');
    assert.strictEqual(stale.weaknessScore, 42.5);
    assert.strictEqual(stale.items.length, 1);
    assert.strictEqual(stale.items[0].domain, 'a.example');

    // 只剩 73h 前那条时，窗口外应返回 null。
    await harness.db.query(`DELETE FROM serp_snapshots WHERE id='srp_stale_71h'`);
    assert.strictEqual(await loadStaleSerp(QRY, '2026-10-18'), null);
  });

  it('72h 内的 Autocomplete 快照可复用，命令行之外返回 null', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { loadStaleAutocomplete } = harness.services;
    const stale = await loadStaleAutocomplete(QRY, '2026-10-18');
    assert.ok(stale);
    assert.deepStrictEqual(stale.suggestions, ['stale a', 'stale b']);
    assert.strictEqual(await loadStaleAutocomplete(QRY, '2026-10-15'), null);
  });

  it('商业证据在 72h 内才算可复用', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { hasStaleCommercialEvidence } = harness.services;
    assert.strictEqual(await hasStaleCommercialEvidence(OPP, 'a.example'), true);
    assert.strictEqual(await hasStaleCommercialEvidence(OPP, 'missing.example'), false);
  });

  it('记录逐域降级引用，同一 obs_date+source+domain 只记一次', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { loadStaleCommercialEvidence, recordStaleDataEvent } = harness.services;
    const prior = await loadStaleCommercialEvidence(OPP, 'a.example');
    assert.ok(prior);

    await recordStaleDataEvent({
      obsDate: '2026-10-18',
      opportunityId: OPP,
      source: 'COMMERCIAL',
      domain: 'a.example',
      referenceId: prior.evidenceId,
      observedAt: new Date(prior.observedAt),
    });
    await recordStaleDataEvent({
      obsDate: '2026-10-18',
      opportunityId: OPP,
      source: 'COMMERCIAL',
      domain: 'a.example',
      referenceId: prior.evidenceId,
      observedAt: new Date(prior.observedAt),
    });

    const rows = await harness.db.query<any>(
      `SELECT source, domain, reference_id, observed_at FROM stale_data_events
        WHERE opportunity_id = $1 AND obs_date = '2026-10-18'`,
      [OPP]
    );
    assert.strictEqual(rows.rows.length, 1);
    assert.strictEqual(rows.rows[0].source, 'COMMERCIAL');
    assert.strictEqual(rows.rows[0].domain, 'a.example');
    assert.strictEqual(rows.rows[0].reference_id, prior.evidenceId);
  });
});
