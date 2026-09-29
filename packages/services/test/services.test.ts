import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import {
  EntitlementService,
  OpportunityService,
  TrackRecordService,
} from '../src';
import { closePool } from '@emeradar/db';

describe('Services Layer Integration Tests', () => {
  after(async () => {
    await closePool();
  });

  it('retrieves user entitlements accurately', async () => {
    const freeEnt = await EntitlementService.getUserEntitlements('usr_demo_free');
    assert.strictEqual(freeEnt.tier, 'FREE');
    assert.strictEqual(freeEnt.exportReportsMonthlyLimit, 1);
    assert.strictEqual(freeEnt.apiAccess, false);
    assert.strictEqual(freeEnt.feedDelayDays, 45);
    assert.strictEqual(freeEnt.opportunityDetailFull, false);
    assert.strictEqual(freeEnt.deepReportExport, false);

    const proEnt = await EntitlementService.getUserEntitlements('usr_demo_pro');
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
