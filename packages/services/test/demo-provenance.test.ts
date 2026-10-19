import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 演示种子不能进公开 Feed。首页/周案例/详情都走 OpportunityService.listFeedCards，
 * 这里钉住最底层：is_demo=true 的 TRACKED 机会不可见。
 */
const harness = makeDisposableDb('emeradar_demo_provenance_test');

async function seedTracked(id: string, isDemo: boolean) {
  const { query } = harness.db;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date, is_demo)
     VALUES ($1, $2, $3, 'TRACKED', CURRENT_DATE, $4)`,
    [id, id.replace(/_/g, '-'), id, isDemo]
  );
  await query(
    `INSERT INTO opportunity_cards (
       opportunity_id, slug, primary_query, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
       confidence, recommended_archetype, execution_class, why_now_summary,
       top_idea, first_observed_at
     ) VALUES ($1, $2, $3, 'BUILD_NOW', 'EARLY_WINDOW',
       8000, 8000, 8000, 'HIGH', 'HIGH', 'HIGH', 'HIGH', 'TOOL', 'S',
       'fixture', 'fixture', NOW())`,
    [id, id.replace(/_/g, '-'), id]
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await seedTracked('opp_demo_visible', true);
  await seedTracked('opp_real_visible', false);
});

after(async () => {
  await harness.teardown();
});

describe('demo 来源隔离', () => {
  it('公开 Feed 只返回真实来源，不返回 demo', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const feed = await harness.services.OpportunityService.listFeedCards({ limit: 10 });
    assert.deepStrictEqual(feed.items.map((item) => item.opportunityId), ['opp_real_visible']);
    assert.strictEqual(feed.total, 1);
  });
});
