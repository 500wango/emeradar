import { describe, it, after, before } from 'node:test';
import assert from 'node:assert';
import {
  EntitlementService,
  OpportunityService,
  TrackRecordService,
} from '../src';
import { closePool, query } from '@emeradar/db';

const entitlementFixtures = [
  { id: 'usr_test_ent_free', tier: 'FREE', plan: 'FREE' },
  { id: 'usr_test_ent_pro', tier: 'PRO', plan: 'PRO' },
] as const;

describe('Services Layer Integration Tests', () => {
  before(async () => {
    for (const fixture of entitlementFixtures) {
      await query(
        `INSERT INTO users (id, email, display_name, role, tier)
         VALUES ($1, $2, $3, 'USER', $4)
         ON CONFLICT (id) DO UPDATE SET tier = EXCLUDED.tier`,
        [fixture.id, `${fixture.id}@emeradar.test`, fixture.id, fixture.tier]
      );
      await query(
        `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_end)
         VALUES ($1, $2, $3, 'ACTIVE', NOW() + INTERVAL '30 days')
         ON CONFLICT (id) DO UPDATE SET plan_code = EXCLUDED.plan_code, status = 'ACTIVE'`,
        [`sub_${fixture.id}`, fixture.id, fixture.plan]
      );
    }
  });

  after(async () => {
    for (const fixture of entitlementFixtures) {
      await query('DELETE FROM users WHERE id = $1', [fixture.id]);
    }
    await closePool();
  });

  it('retrieves user entitlements accurately', async () => {
    const freeEnt = await EntitlementService.getUserEntitlements('usr_test_ent_free');
    assert.strictEqual(freeEnt.tier, 'FREE');
    assert.strictEqual(freeEnt.exportReportsMonthlyLimit, 1);
    assert.strictEqual(freeEnt.apiAccess, false);
    assert.strictEqual(freeEnt.feedDelayDays, 45);
    assert.strictEqual(freeEnt.opportunityDetailFull, false);
    assert.strictEqual(freeEnt.deepReportExport, false);

    const proEnt = await EntitlementService.getUserEntitlements('usr_test_ent_pro');
    assert.strictEqual(proEnt.tier, 'PRO');
    assert.strictEqual(proEnt.exportReportsMonthlyLimit, 30);
    assert.strictEqual(proEnt.apiAccess, true);
    assert.strictEqual(proEnt.feedDelayDays, 0);
    assert.strictEqual(proEnt.opportunityDetailFull, true);
    assert.strictEqual(proEnt.deepReportExport, true);
  });

  it('does not treat invented examples as published decisions', async () => {
    const feed = await OpportunityService.listFeedCards({ verdict: 'BUILD_NOW' });
    assert.ok(feed.items.every((item) => item.slug !== 'shopify-sales-tax-calculator'));
    assert.ok(feed.items.every((item) => item.confidence !== 'LOW'));
  });

  it('keeps live observations unpublished', async () => {
    const observations = await OpportunityService.listLiveObservations({ limit: 50 });
    for (const item of observations) {
      assert.strictEqual(item.verdict, 'WATCH');
      assert.strictEqual(item.confidence, 'LOW');
      assert.strictEqual(item.dBand, 'INSUFFICIENT');
    }
  });

  it('does not invent a hit rate when no episode has been evaluated', async () => {
    const record = await TrackRecordService.getPublicTrackRecord();
    if (record.stats.evaluatedEpisodes === 0) {
      assert.strictEqual(record.stats.hitRate30d, null);
    }
  });
});
