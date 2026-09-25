import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import {
  EntitlementService,
  OpportunityService,
  TrackRecordService,
  ReportService,
  ProjectService,
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

    const proEnt = await EntitlementService.getUserEntitlements('usr_demo_pro');
    assert.strictEqual(proEnt.tier, 'PRO');
    assert.strictEqual(proEnt.exportReportsMonthlyLimit, 30);
    assert.strictEqual(proEnt.apiAccess, true);
  });

  it('queries feed cards with filters', async () => {
    const feed = await OpportunityService.listFeedCards({
      verdict: 'BUILD_NOW',
    });
    assert.ok(feed.items.length >= 2);
    assert.strictEqual(feed.items[0].verdict, 'BUILD_NOW');

    // Search query
    const searchRes = await OpportunityService.listFeedCards({
      search: 'Shopify',
    });
    assert.ok(searchRes.items.length >= 1);
    assert.strictEqual(searchRes.items[0].slug, 'shopify-sales-tax-calculator');
  });

  it('retrieves complete opportunity workspace detail with SERP & evidence', async () => {
    const detail = await OpportunityService.getOpportunityDetail('opp_shopify_tax');
    assert.strictEqual(detail.opportunity.id, 'opp_shopify_tax');
    assert.ok(detail.queries.length >= 1);
    assert.ok(detail.serpResults.length >= 5);
    assert.ok(detail.evidence.length >= 1);
    assert.ok(detail.killCriteria.length >= 1);
    assert.strictEqual(detail.latestVerdict.verdict, 'BUILD_NOW');
  });

  it('cryptographically verifies Merkle root in track record checkpoint', async () => {
    const verification = await TrackRecordService.verifyCheckpoint('2026-09-25');
    assert.strictEqual(verification.verified, true);
    assert.strictEqual(verification.rowCount, 5);
    assert.strictEqual(typeof verification.storedMerkleRoot, 'string');
    assert.strictEqual(verification.storedMerkleRoot.length, 64);
  });

  it('retrieves cached opportunity report without deducting quota', async () => {
    const reportRes = await ReportService.getOrGenerateReport(
      'opp_shopify_tax',
      'usr_demo_pro',
      'en-US'
    );
    assert.strictEqual(reportRes.cached, true);
    assert.ok(reportRes.data.metadata.title.includes('Shopify'));
    assert.ok(reportRes.markdown.includes('## 1. 📊 Executive Summary'));
  });

  it('lists user projects with GSC impressions', async () => {
    const projects = await ProjectService.listUserProjects('usr_demo_pro');
    assert.ok(projects.length >= 1);
    const prj = projects.find((p) => p.id === 'prj_sp_tax_demo');
    assert.ok(prj, 'Should find seeded demo project');
    assert.ok(prj.total_impressions > 0);
  });
});
