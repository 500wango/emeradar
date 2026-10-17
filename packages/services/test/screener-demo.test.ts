import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

const harness = makeDisposableDb('emeradar_screener_demo_test');

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const { query } = harness.db;
  await query(
    `INSERT INTO screener_demos (demo_id, query, snapshot, snapshot_date, position)
     VALUES ('demo_frozen', 'invoice generator', '{"verdict":"WATCH","weakResultCount":4}'::jsonb, '2026-10-01', 1),
            ('demo_empty', 'pdf merge', NULL, NULL, 2)`
  );
});
after(async () => {
  await harness.teardown();
});

describe('Screener demos', () => {
  it('lists demos in position order without touching any collector', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const demos = await harness.services.ScreenerDemoService.list();
    assert.deepStrictEqual(demos.map((d: any) => d.demo_id), ['demo_frozen', 'demo_empty']);
  });

  it('serves the frozen snapshot verbatim', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const demo = await harness.services.ScreenerDemoService.get('demo_frozen');
    assert.deepStrictEqual(demo.result, { verdict: 'WATCH', weakResultCount: 4 });
  });

  it('503s with DEMO_UNAVAILABLE when no snapshot is frozen, and 404s for unknown ids', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await assert.rejects(
      () => harness.services.ScreenerDemoService.get('demo_empty'),
      (e: any) => e.status === 503
    );
    await assert.rejects(
      () => harness.services.ScreenerDemoService.get('demo_nope'),
      (e: any) => e.status === 404
    );
  });

  it('allows at most three demos', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await assert.rejects(() =>
      harness.db.query(`INSERT INTO screener_demos (demo_id, query, position) VALUES ('demo_x', 'x', 4)`)
    );
  });
});
