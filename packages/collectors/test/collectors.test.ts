import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AutocompleteCollector,
  SerpCollector,
  CrawlCollector,
  CheckoutReferralsCollector,
  RunContext,
  BudgetGuard,
} from '../src';

function createMockContext(dailyBudget = 10.0, currentSpent = 0.0): RunContext {
  const budget: BudgetGuard = {
    maxDailyBudgetUsd: dailyBudget,
    currentSpentUsd: currentSpent,
    canSpend(cost: number) {
      return this.currentSpentUsd + cost <= this.maxDailyBudgetUsd;
    },
  };

  return {
    runId: 'run_test_123',
    obsDate: '2026-09-25',
    clock: () => new Date('2026-09-25T12:00:00Z'),
    budget,
  };
}

describe('AutocompleteCollector', () => {
  const collector = new AutocompleteCollector();

  it('should plan batch with estimated cost', async () => {
    const ctx = createMockContext();
    const batch = await collector.plan(ctx, [
      { queryId: 'q_1', queryText: 'cron generator' },
      { queryId: 'q_2', queryText: 'og image api' },
    ]);

    assert.equal(batch.items.length, 2);
    assert.ok(batch.estimatedCostUsd > 0);
    assert.ok(batch.batchId.startsWith('batch_ac_'));
  });

  it('should skip collection when budget guard is exceeded', async () => {
    const ctx = createMockContext(0.0001, 0.0001); // Exceeded budget
    const outcome = await collector.collect(ctx, {
      queryId: 'q_1',
      queryText: 'cron generator',
    });

    assert.equal(outcome.status, 'SKIPPED');
    if (outcome.status === 'SKIPPED') {
      assert.equal(outcome.reason, 'BUDGET');
    }
  });

  it('should collect suggestions, generate snapshot, evidence and raw hash', async () => {
    const ctx = createMockContext();
    const outcome = await collector.collect(ctx, {
      queryId: 'q_1',
      queryText: 'cron generator',
      opportunityId: 'opp_cron_gen',
    });

    assert.ok(outcome.status === 'OK' || outcome.status === 'FAILED');
    if (outcome.status === 'FAILED') {
      assert.equal(outcome.errorCode, 'AC_FETCH_ERROR');
    }
    if (outcome.status === 'OK') {
      assert.equal(outcome.snapshots.length, 1);
      assert.equal(outcome.snapshots[0].entityType, 'AUTOCOMPLETE');
      assert.ok(outcome.snapshots[0].data.suggestions.length > 0);

      assert.equal(outcome.evidence.length, 1);
      assert.equal(outcome.evidence[0].evidenceClass, 'OBSERVED');
      assert.equal(outcome.evidence[0].opportunityId, 'opp_cron_gen');

      assert.ok(outcome.raw);
      assert.equal(outcome.raw.mimeType, 'application/json');
      assert.equal(outcome.raw.contentHash.length, 64); // SHA-256

      assert.ok(outcome.cost.costUsd > 0);
      assert.equal(outcome.cost.category, 'AUTOCOMPLETE');
    }
  });
});

describe('SerpCollector', () => {
  const collector = new SerpCollector();

  it('should plan batch with estimated cost', async () => {
    const ctx = createMockContext();
    const batch = await collector.plan(ctx, [
      { queryId: 'q_1', queryText: 'cron generator' },
    ]);
    assert.equal(batch.items.length, 1);
    assert.ok(batch.estimatedCostUsd > 0);
  });

  it('should collect SERP, calculate weakness score, classify domain authority', async () => {
    const ctx = createMockContext();
    const outcome = await collector.collect(ctx, {
      queryId: 'q_1',
      queryText: 'how to generate cron expressions free',
      opportunityId: 'opp_cron_gen',
    });

    assert.ok(outcome.status === 'OK' || outcome.status === 'FAILED');
    if (outcome.status === 'FAILED') {
      assert.equal(outcome.errorCode, 'SERP_UNAVAILABLE');
    }
    if (outcome.status === 'OK') {
      assert.equal(outcome.snapshots.length, 1);
      assert.equal(outcome.snapshots[0].entityType, 'SERP');

      const serpData = outcome.snapshots[0].data;
      assert.ok(serpData.items.length > 0);
      assert.ok(serpData.weakResultRatio >= 0);
      assert.ok(serpData.weaknessScore >= 0);

      // Verify domain classification logic
      const redditItem = serpData.items.find((i: any) => i.domain === 'reddit.com');
      if (redditItem) {
        assert.equal(redditItem.domainAuthorityClass, 'COMMUNITY_FORUM');
        assert.equal(redditItem.isWeak, true);
      }

      assert.equal(outcome.evidence.length, 1);
      assert.equal(outcome.evidence[0].evidenceClass, 'OBSERVED');
      assert.equal(outcome.raw?.contentHash.length, 64);
    }
  });

  it('should support AIsa search provider when AISA_API_KEY is configured', async () => {
    const originalFetch = globalThis.fetch;
    process.env.AISA_API_KEY = 'test_aisa_key';
    const oldSerpKey = process.env.SERP_API_KEY;
    delete process.env.SERP_API_KEY;

    globalThis.fetch = async (url: any, opts: any) => {
      if (String(url).includes('aisa.one')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: 'Best Cron Generator on Reddit',
                url: 'https://reddit.com/r/webdev/cron',
                content: 'Community forum discussion',
              },
              {
                title: 'Official Cron Service',
                url: 'https://cronhub.io',
                content: 'Official site tool',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(url, opts);
    };

    try {
      const ctx = createMockContext();
      const outcome = await collector.collect(ctx, {
        queryId: 'q_aisa',
        queryText: 'cron online',
        opportunityId: 'opp_cron',
      });

      assert.equal(outcome.status, 'OK');
      if (outcome.status === 'OK') {
        const serpData = outcome.snapshots[0].data;
        assert.equal(serpData.items.length, 2);
        assert.equal(serpData.items[0].domain, 'reddit.com');
        assert.equal(serpData.items[0].isWeak, true);
        assert.equal(serpData.items[1].domain, 'cronhub.io');
      }
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.AISA_API_KEY;
      if (oldSerpKey) process.env.SERP_API_KEY = oldSerpKey;
    }
  });
});

describe('CrawlCollector', () => {
  const collector = new CrawlCollector();

  it('should extract static pricing plans and payment gateways', () => {
    const mockHtml = `
      <div>
        <h1>Pricing</h1>
        <div class="card">
          <h2>Starter</h2>
          <span class="price">$19/mo</span>
        </div>
        <div class="card">
          <h2>Enterprise</h2>
          <span class="price">$199/month</span>
        </div>
        <script src="https://js.stripe.com/v3/"></script>
      </div>
    `;

    const plans = collector.extractPricingPlans(mockHtml);
    const gateways = collector.detectPaymentGateways(mockHtml);

    assert.equal(plans.length, 2);
    assert.equal(plans[0].name, 'Starter');
    assert.equal(plans[0].priceMonthly, 19);
    assert.equal(plans[1].name, 'Enterprise');
    assert.equal(plans[1].priceMonthly, 199);

    assert.deepEqual(gateways, ['Stripe']);
  });

  it('should collect commercial data and classify PRICED stage', async () => {
    const ctx = createMockContext();
    const outcome = await collector.collect(ctx, {
      targetId: 'cmt_1',
      domain: 'crontool.test',
      targetUrl: 'https://crontool.test/pricing',
      opportunityId: 'opp_cron_gen',
    });

    assert.equal(outcome.status, 'OK');
    if (outcome.status === 'OK') {
      assert.equal(outcome.snapshots.length, 1);
      assert.equal(outcome.snapshots[0].entityType, 'COMMERCIAL');

      const data = outcome.snapshots[0].data;
      assert.equal(data.domain, 'crontool.test');
      assert.equal(data.commercialStage, 'PRICED');
      assert.ok(data.pricingPlans.length > 0);
      assert.ok(data.paymentGateways.includes('Stripe'));

      assert.equal(outcome.evidence.length, 1);
      assert.equal(outcome.evidence[0].evidenceClass, 'OBSERVED');
      assert.equal(outcome.evidence[0].sourceType, 'PAID_TIER_OBSERVED');
      assert.equal(data.dynamicShell, false);
      assert.equal(outcome.raw?.contentHash.length, 64);
    }
  });

  it('should upgrade to Tier 2 Headless when dynamic SPA detected', async () => {
    const ctx = createMockContext();
    const outcome = await collector.collect(ctx, {
      targetId: 'cmt_spa',
      domain: 'dynamic-saas.test',
      targetUrl: 'https://dynamic-saas.test/spa-pricing',
      opportunityId: 'opp_cron_gen',
    });

    assert.equal(outcome.status, 'OK');
    if (outcome.status === 'OK') {
      const data = outcome.snapshots[0].data;
      assert.equal(data.fetchTier, 'HEADLESS');
      assert.equal(data.dynamicShell, true);
      assert.equal(data.commercialStage, 'PRICED');
      assert.ok(data.pricingPlans.some((p: any) => p.name === 'Hobby'));
    }
  });
});

describe('CheckoutReferralsCollector', () => {
  const collector = new CheckoutReferralsCollector();

  it('should plan batch with estimated items and budget', async () => {
    const ctx = createMockContext();
    const batch = await collector.plan(ctx, [
      { targetId: 't1', domain: 'tool-a.io' },
      { targetId: 't2', domain: 'tool-b.com' },
    ]);
    assert.equal(batch.items.length, 2);
    assert.ok(batch.estimatedCostUsd > 0);
  });

  it('should detect live Stripe checkout link and emit OBSERVED evidence', async () => {
    const ctx = createMockContext();
    const htmlSnippet = `
      <html>
        <body>
          <h1>Super SEO Tool</h1>
          <p>Get started today for only $29/mo</p>
          <a href="https://checkout.stripe.com/c/pay/cs_live_a1b2c3d4e5">Upgrade to Pro</a>
        </body>
      </html>
    `;

    const outcome = await collector.collect(ctx, {
      targetId: 'chk_1',
      domain: 'superseo.io',
      htmlSnippet,
      opportunityId: 'opp_super_seo',
    });

    assert.equal(outcome.status, 'OK');
    if (outcome.status === 'OK') {
      assert.equal(outcome.snapshots.length, 1);
      assert.equal(outcome.snapshots[0].entityType, 'COMMERCIAL');
      assert.equal(outcome.snapshots[0].data.detectedCount, 1);
      assert.equal(outcome.snapshots[0].data.signals[0].gateway, 'STRIPE');
      assert.equal(outcome.snapshots[0].data.signals[0].integrationType, 'HOSTED_CHECKOUT');

      assert.equal(outcome.evidence.length, 1);
      assert.equal(outcome.evidence[0].evidenceClass, 'OBSERVED');
      assert.equal(outcome.evidence[0].sourceType, 'CHECKOUT_REFERRAL_RADAR');
      assert.equal(outcome.evidence[0].payload.gateway, 'STRIPE');
      assert.equal(outcome.evidence[0].payload.extractedPriceUsd, 29);
      assert.equal(outcome.evidence[0].payload.evidenceHash.length, 64);
    }
  });

  it('should detect LemonSqueezy buy link with direct pricing', async () => {
    const ctx = createMockContext();
    const sampleUrls = [
      'https://myindietool.lemonsqueezy.com/buy/4a9c8b7d-1234',
    ];

    const outcome = await collector.collect(ctx, {
      targetId: 'chk_2',
      domain: 'myindietool.com',
      sampleUrls,
      opportunityId: 'opp_indie_tool',
    });

    assert.equal(outcome.status, 'OK');
    if (outcome.status === 'OK') {
      assert.equal(outcome.snapshots[0].data.detectedCount, 1);
      assert.equal(outcome.snapshots[0].data.signals[0].gateway, 'LEMON_SQUEEZY');
      assert.equal(outcome.snapshots[0].data.signals[0].integrationType, 'DIRECT_BUY_LINK');
      assert.equal(outcome.evidence[0].evidenceClass, 'OBSERVED');
    }
  });
});
