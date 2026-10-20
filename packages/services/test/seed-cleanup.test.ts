import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 旧候选清理：只处理关键词种子来源，只改状态，不碰用户手动扫描的词。
 */
const harness = makeDisposableDb('emeradar_seed_cleanup_test');

async function seed(id: string, title: string, source: string) {
  await harness.db.query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date, discovery_source)
     VALUES ($1, $2, $3, 'CANDIDATE', CURRENT_DATE, $4)`,
    [id, id.replace(/_/g, '-'), title, source]
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await seed('opp_clean_bare', 'checker', 'KEYWORD_SEED');
  await seed('opp_clean_physical', 'electric generator', 'KEYWORD_SEED');
  await seed('opp_clean_spliced', 'time tracker & employee timesheet software', 'KEYWORD_SEED');
  await seed('opp_clean_good', 'invoice generator', 'KEYWORD_SEED');
  await seed('opp_clean_live', 'checker', 'LIVE_SCAN');
});

after(async () => {
  await harness.teardown();
});

describe('旧候选清理', () => {
  it('dry run 只报告，不改状态', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const report = await harness.services.scanSeedCandidates();
    assert.strictEqual(report.scanned, 4, '只扫 KEYWORD_SEED');
    const titles = report.rejected.map((row: any) => row.title).sort();
    assert.deepStrictEqual(titles, [
      'checker',
      'electric generator',
      'time tracker & employee timesheet software',
    ]);

    const rows = await harness.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM opportunities WHERE status = 'ARCHIVED'`
    );
    assert.strictEqual(rows.rows[0].count, 0, 'dry run 不得改动任何行');
  });

  it('apply 只归档不合格的种子候选，保留合格词与用户扫描词', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const report = await harness.services.scanSeedCandidates();
    const archived = await harness.services.applySeedCandidateCleanup(report, null);
    assert.strictEqual(archived, 3);

    const rows = await harness.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM opportunities ORDER BY id`
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row.status]));
    assert.strictEqual(byId.opp_clean_bare, 'ARCHIVED');
    assert.strictEqual(byId.opp_clean_physical, 'ARCHIVED');
    assert.strictEqual(byId.opp_clean_spliced, 'ARCHIVED');
    assert.strictEqual(byId.opp_clean_good, 'CANDIDATE', '合格词不得被误伤');
    assert.strictEqual(byId.opp_clean_live, 'CANDIDATE', '用户扫描的词不得被动');
  });
});
