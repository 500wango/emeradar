import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AutocompleteCollector,
  SerpCollector,
  CrawlCollector,
  CheckoutReferralsCollector,
  RunContext,
  BudgetGuard,
  SERP_DEPTH,
  SERP_DEFAULT_DEPTH,
  SERP_SCORING_DEPTH,
  parseDataForSeoOrganic,
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

/** DataForSEO 的 SERP 信封（经 AIsa 原样转发）：结论在 `tasks[0].status_code`。 */
function dataForSeoSerp(results: Array<{ title: string; url: string; content: string }>, statusCode = 20000) {
  return {
    tasks: [
      {
        status_code: statusCode,
        result: [
          {
            items: results.map((r, i) => ({
              type: 'organic',
              rank_group: i + 1,
              rank_absolute: i + 2,
              url: r.url,
              title: r.title,
              description: r.content,
            })),
          },
        ],
      },
    ],
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

  it('should collect suggestions via AIsa DataForSEO, generate snapshot, evidence and raw hash', async () => {
    const originalFetch = globalThis.fetch;
    const oldKey = process.env.AISA_API_KEY;
    process.env.AISA_API_KEY = 'test_aisa_key';
    let seenBody: any = null;
    globalThis.fetch = (async (_url: any, opts: any) => {
      seenBody = JSON.parse(opts.body);
      return new Response(
        JSON.stringify({
          tasks: [
            {
              status_code: 20000,
              result: [{ items: [{ suggestion: 'cron generator free' }, { suggestion: 'cron job monitor' }] }],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'x-aisa-customer-cost-micros-usd': '500' } }
      );
    }) as any;

    try {
      const ctx = createMockContext();
      const outcome = await collector.collect(ctx, {
        queryId: 'q_1',
        queryText: 'cron generator',
        opportunityId: 'opp_cron_gen',
      });

      assert.equal(outcome.status, 'OK', 'AIsa autocomplete 没有被正确解析');
      if (outcome.status === 'FAILED') {
        assert.equal(outcome.errorCode, 'AC_FETCH_ERROR');
      }
      assert.deepEqual(seenBody[0].keyword, 'cron generator');
      assert.equal(seenBody[0].location_code, 2840);
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
      assert.equal(outcome.snapshots[0].data.provider, 'AISA_DATAFORSEO');
    }
    } finally {
      globalThis.fetch = originalFetch;
      if (oldKey === undefined) delete process.env.AISA_API_KEY;
      else process.env.AISA_API_KEY = oldKey;
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

  it('should fetch Google organic results via AIsa → DataForSEO when AISA_API_KEY is configured', async () => {
    const originalFetch = globalThis.fetch;
    process.env.AISA_API_KEY = 'test_aisa_key';
    const oldSerpKey = process.env.SERP_API_KEY;
    delete process.env.SERP_API_KEY;
    let seenUrl = '';
    let seenBody: any = null;
    let seenAuth = '';

    globalThis.fetch = async (url: any, opts: any) => {
      if (String(url).includes('aisa.one')) {
        seenUrl = String(url);
        seenBody = JSON.parse(opts.body);
        seenAuth = opts.headers.Authorization;
        return new Response(
          JSON.stringify(dataForSeoSerp([
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
          ])),
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
        // 名次取 rank_group（自然结果内部序号），不是把 SERP 特性也算进去的 rank_absolute。
        assert.equal(serpData.items[0].rank, 1);
        assert.equal(serpData.provider, 'AISA_DATAFORSEO');
      }
      assert.equal(seenUrl, 'https://api.aisa.one/apis/v1/dataforseo/serp/google/organic/live/regular');
      assert.equal(seenAuth, 'Bearer test_aisa_key');
      assert.deepEqual(seenBody, [{ keyword: 'cron online', location_code: 2840, language_code: 'en', depth: 10 }]);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.AISA_API_KEY;
      if (oldSerpKey) process.env.SERP_API_KEY = oldSerpKey;
    }
  });

  /**
   * 一鱼多吃（04 §9.2）的判据全在这一个用例里。
   *
   * 采集深度从 10 提到 100 之后，最容易出的错不是"少拿了"，而是**多拿了却不该用**：
   *   - 前 10 名之外的条目混进 `items`，会写进 `serp_results` 撞上 `rank BETWEEN 1 AND 20`
   *     的 CHECK，也会让商业域抓取从 10 个域名涨到 100 个（成本十倍）；
   *   - 弱结果比率的分母若跟着变成取回条数，"前 10 名里几个是弱点"就变成了"前 100 名
   *     里几个是弱点"——同一个词在两天的不同深度下给出两个不可比的数。
   *
   * 所以夹具刻意做成"前 10 名全是弱点、11 名之后全是干净站"：分母错了，比率就从 1
   * 变成 0.4，这条断言会当场抓到。
   */
  it('should keep rank 11-100 out of the scoring slice but available for rank matching', async () => {
    const originalFetch = globalThis.fetch;
    process.env.AISA_API_KEY = 'test_aisa_depth_key';
    const oldSerpKey = process.env.SERP_API_KEY;
    delete process.env.SERP_API_KEY;

    // 10 个论坛帖（弱点）+ 15 个独立站（非弱点），共 25 条。
    const stubResults = [
      ...Array.from({ length: 10 }, (_, i) => ({
        title: `Cron thread ${i + 1}`,
        url: `https://reddit.com/r/webdev/cron/${i + 1}`,
        content: 'Community forum discussion',
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        title: `Clean tool ${i + 1}`,
        url: `https://clean-tool-${i + 1}.example/`,
        content: 'A focused independent tool',
      })),
    ];

    globalThis.fetch = async () =>
      new Response(JSON.stringify(dataForSeoSerp(stubResults)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    try {
      const outcome = await collector.collect(createMockContext(), {
        queryId: 'q_depth',
        queryText: 'cron online',
        opportunityId: 'opp_depth',
        // 项目排名追踪的周采集才取 100（ADR-022）。
        depth: SERP_DEPTH,
      });

      assert.equal(outcome.status, 'OK');
      if (outcome.status !== 'OK') return;
      const serpData = outcome.snapshots[0].data;

      // 评分集只有前 10 名，且深度与条数被如实记录下来。
      assert.equal(serpData.items.length, SERP_SCORING_DEPTH);
      assert.ok(serpData.items.every((item: any) => item.rank <= SERP_SCORING_DEPTH));
      assert.equal(serpData.depth, SERP_DEPTH);
      assert.equal(serpData.resultCount, 25);

      // 分母是评分集大小，不是取回条数。
      assert.equal(serpData.weakResultRatio, 1);

      // 名次索引覆盖全部取回条目——排名追踪唯一的输入。
      assert.equal(serpData.rankIndex.length, 25);
      assert.deepEqual(
        serpData.rankIndex.map((entry: any) => entry.rank),
        Array.from({ length: 25 }, (_, i) => i + 1)
      );
      assert.equal(serpData.rankIndex[24].domain, 'clean-tool-15.example');
      assert.equal(serpData.rankIndex[24].url, 'https://clean-tool-15.example/');

      // 证据载荷里的 `top10Count` 曾经等于取回条数，现在必须仍是 10。
      assert.equal(outcome.evidence[0].payload.top10Count, SERP_SCORING_DEPTH);
      // 名次索引不进原始载荷：它是匹配用的中间量，不是我们"观察到"的证据。
      assert.ok(!JSON.parse(outcome.raw!.content).rankIndex);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.AISA_API_KEY;
      if (oldSerpKey) process.env.SERP_API_KEY = oldSerpKey;
    }
  });

  it('requests and records Top 10 by default (ADR-022)', async () => {
    const originalFetch = globalThis.fetch;
    process.env.AISA_API_KEY = 'test_aisa_default_depth_key';
    const oldSerpKey = process.env.SERP_API_KEY;
    delete process.env.SERP_API_KEY;

    const stubResults = Array.from({ length: 25 }, (_, i) => ({
      title: `Clean tool ${i + 1}`,
      url: `https://clean-tool-${i + 1}.example/`,
      content: 'A focused independent tool',
    }));
    globalThis.fetch = async () =>
      new Response(JSON.stringify(dataForSeoSerp(stubResults)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    try {
      const outcome = await collector.collect(createMockContext(), {
        queryId: 'q_default_depth',
        queryText: 'cron online',
        opportunityId: 'opp_default_depth',
      });
      assert.equal(outcome.status, 'OK');
      if (outcome.status !== 'OK') return;
      const serpData = outcome.snapshots[0].data;
      assert.equal(SERP_DEFAULT_DEPTH, 10);
      assert.equal(serpData.depth, SERP_DEFAULT_DEPTH);
      assert.equal(serpData.resultCount, SERP_DEFAULT_DEPTH);
      assert.equal(serpData.rankIndex.length, SERP_DEFAULT_DEPTH);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.AISA_API_KEY;
      if (oldSerpKey) process.env.SERP_API_KEY = oldSerpKey;
    }
  });
});

describe('parseDataForSeoOrganic', () => {
  const infer = () => 'SPECIALIST' as const;

  it('treats a rejected task as failure even though the HTTP status was 200', () => {
    assert.equal(parseDataForSeoOrganic(dataForSeoSerp([], 40501), 10, infer), null);
    assert.equal(parseDataForSeoOrganic({}, 10, infer), null);
  });

  it('keeps only organic items within depth, ranked by rank_group', () => {
    const body = {
      tasks: [{ status_code: 20000, result: [{ items: [
        { type: 'featured_snippet', rank_group: 1, url: 'https://snippet.example/', title: 's' },
        { type: 'organic', rank_group: 1, url: 'https://www.one.example/a', title: 'one', description: 'd' },
        { type: 'video', rank_group: 1, url: 'https://video.example/', title: 'v' },
        { type: 'organic', rank_group: 2, url: 'https://two.example/', title: 'two' },
        { type: 'organic', rank_group: 11, url: 'https://eleven.example/', title: 'eleven' },
        { type: 'organic', rank_group: 3, url: 'not-a-url', title: 'bad' },
      ] }] }],
    };
    const rows = parseDataForSeoOrganic(body, 10, infer)!;
    assert.deepEqual(rows.map((r) => [r.rank, r.domain]), [[1, 'one.example'], [2, 'two.example']]);
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
