import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Admin 看板的宽限期降级记录：必须能回答"哪条机会、哪个源、哪一天用了旧快照"。
 */
const harness = makeDisposableDb('emeradar_admin_overview_stale_test');
const OPP = 'opp_admin_stale';

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const { query } = harness.db;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, 'admin-stale', 'Admin Stale Opp', 'TRACKED', CURRENT_DATE)`,
    [OPP]
  );
  await query(
    `INSERT INTO stale_data_events (obs_date, opportunity_id, source, domain, reference_id, observed_at)
     VALUES (CURRENT_DATE, $1, 'COMMERCIAL', 'a.example', 'ev_123', NOW()),
            (CURRENT_DATE, $1, 'SERP', '', 'srp_abc', NOW())`,
    [OPP]
  );
});

after(async () => {
  await harness.teardown();
});

describe('Admin 看板：STALE_DATA 记录', () => {
  it('返回最近的降级来源与引用', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const overview = await harness.services.AdminService.getPipelineOverview();
    const events = overview.recentStaleEvents ?? [];
    assert.strictEqual(events.length, 2);
    assert.ok(events.some((e) => e.source === 'COMMERCIAL' && e.domain === 'a.example'));
    assert.ok(events.some((e) => e.source === 'SERP' && e.referenceId === 'srp_abc'));
    assert.strictEqual(events[0].opportunityTitle, 'Admin Stale Opp');
    assert.strictEqual(events[0].opportunitySlug, 'admin-stale');
  });
});
