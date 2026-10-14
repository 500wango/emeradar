import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateSerpWeakness,
  calculateDemandScore,
  calculateWindowScore,
  calculateConfidence,
  evaluateVerdict,
  evaluateLifecycle,
  calculateOpportunityScore,
  buildPrevScoringState,
  wDroppedWithin,
  WINDOW_CLOSING_FRESHNESS_DAYS,
  FullOpportunityScoreInput,
} from '../src';

describe('Scoring Engine Unit Tests', () => {
  it('calculates SERP weakness with age and relevance adjustments', () => {
    const res = calculateSerpWeakness([
      {
        rank: 1,
        url: 'https://example.com/outdated-blog',
        domain: 'example.com',
        title: 'Old blog post',
        resultType: 'EDITORIAL_MEDIA', // base 0.2
        ageDays: 800, // +0.2
        relevance: 0.8,
      }, // total 0.4
      {
        rank: 2,
        url: 'https://reddit.com/r/shopify/comments',
        domain: 'reddit.com',
        title: 'Reddit question',
        resultType: 'UGC_THREAD', // base 0.6
        ageDays: 50,
        relevance: 0.9,
      }, // total 0.6
      {
        rank: 3,
        url: 'https://tax-pro.com',
        domain: 'tax-pro.com',
        title: 'Pro calculator',
        resultType: 'SPECIALIST', // base 0.0
        ageDays: 30,
        relevance: 1.0,
      }, // total 0.0
    ]);

    assert.ok(res.score > 0);
    assert.strictEqual(res.items.length, 3);
    assert.strictEqual(res.items[0].totalWeakness, 0.4);
    assert.strictEqual(res.items[1].totalWeakness, 0.6);
    assert.strictEqual(res.items[1].isWeak, true);
    assert.strictEqual(res.items[2].totalWeakness, 0.0);
    assert.strictEqual(res.weakCount, 1);
    assert.strictEqual(res.innerPagesCount, 2);
    assert.strictEqual(res.homepageCount, 1);
    assert.ok(Array.isArray(res.structuralPenetrationReasons));
  });

  it('detects weak sites and brand alternative intercept angle', () => {
    const res = calculateSerpWeakness([
      {
        rank: 1,
        url: 'https://canva.com',
        domain: 'canva.com',
        title: 'Canva Official',
        resultType: 'OFFICIAL',
      },
      {
        rank: 2,
        url: 'https://newtool.com',
        domain: 'newtool.com',
        title: 'New Young Tool',
        resultType: 'SPECIALIST',
        domainDr: 18,
        ageDays: 120,
      },
    ]);

    assert.strictEqual(res.weakSitesCount, 1);
    assert.strictEqual(res.penetrationAngle, 'ALTERNATIVE_INTERCEPT');
    assert.ok(res.structuralPenetrationReasons.some((r) => r.includes('弱站')));
  });

  it('marks demand as INSUFFICIENT if historyDays < 14', () => {
    const res = calculateDemandScore({
      clusterSize: 20,
      newQueries7d: 10,
      clusterGrowth30d: 0.8,
      expansionSlope30d: 0.5,
      attentionSourcesActive14d: 3,
      attentionGrowth14d: 0.5,
      historyDays: 7, // below 14
    });
    assert.strictEqual(res.band, 'INSUFFICIENT');
    assert.strictEqual(res.basisPoints, 0);
  });

  it('evaluates high demand when velocity and cluster thresholds are met', () => {
    const res = calculateDemandScore({
      clusterSize: 12,
      newQueries7d: 6,
      clusterGrowth30d: 1.2,
      expansionSlope30d: 0.8,
      attentionSourcesActive14d: 3,
      attentionGrowth14d: 0.5,
      historyDays: 45,
    });
    assert.strictEqual(res.band, 'HIGH');
    assert.ok(res.basisPoints >= 7500);
  });

  it('calculates open window with low incumbent pressure', () => {
    const res = calculateWindowScore({
      serpWeakness: 75.0,
      eSpecialist30d: 0,
      eAuthoritative30d: 0,
      volatility30d: 2,
      crowdingIndex: 10,
      serpHistoryDays: 30,
      recentSerpSnapshotAvailable: true,
    });
    assert.strictEqual(res.band, 'HIGH');
    assert.ok(res.basisPoints >= 7000);
  });

  it('evaluates BUILD_NOW verdict when all dimensions are strong and verified', () => {
    const res = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'HIGH',
        independentDomainsCount: 3,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        totalScore: 7800,
      },
      wBand: 'HIGH',
      confidence: 'HIGH',
      historyDays: 45,
    });
    assert.strictEqual(res.rawVerdict, 'BUILD_NOW');
    assert.strictEqual(res.verdict, 'BUILD_NOW');
  });

  it('routes two decoration-priced domains through the compensated rule, not standard BUILD_NOW', () => {
    const res = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'MEDIUM',
        independentDomainsCount: 2,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        pricingDecorationOnly: true,
        totalScore: 6500,
      },
      wBand: 'HIGH',
      confidence: 'HIGH',
      historyDays: 30,
    });
    assert.strictEqual(res.rawVerdict, 'BUILD_NOW');
    assert.ok(res.rulesTriggered.includes('RULE_BUILD_NOW_COMPENSATED'));
    assert.ok(!res.rulesTriggered.includes('RULE_BUILD_NOW'));
  });

  it('does not publish BUILD_NOW for decoration pricing without a breakout signal', () => {
    const res = evaluateVerdict({
      dBand: 'MEDIUM',
      mSummary: {
        band: 'MEDIUM',
        independentDomainsCount: 2,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        pricingDecorationOnly: true,
        totalScore: 6200,
      },
      wBand: 'MEDIUM',
      confidence: 'MEDIUM',
      historyDays: 30,
    });
    assert.notStrictEqual(res.rawVerdict, 'BUILD_NOW');
    assert.strictEqual(res.rawVerdict, 'WATCH');
  });

  it('immediately yields PASS when strong negative commercial signal exists (bypassing debounce)', () => {
    const res = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'HIGH',
        independentDomainsCount: 3,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: true, // negative
        negativeReasons: ['Official platform announced free native replacement'],
        totalScore: 1000,
      },
      wBand: 'HIGH',
      confidence: 'HIGH',
      prev: {
        verdict: 'BUILD_NOW',
        rawVerdict: 'BUILD_NOW',
        lifecycle: 'EARLY_WINDOW',
        daysInCurrentVerdict: 10,
        daysInCurrentLifecycle: 10,
        wBandHistory: ['HIGH', 'HIGH'],
      },
      historyDays: 60,
    });
    assert.strictEqual(res.verdict, 'PASS');
    assert.ok(res.flags.includes('M_NEGATIVE'));
    assert.ok(res.rulesTriggered.includes('DEBOUNCE_BYPASS_NEGATIVE_M'));
  });

  it('guarantees deterministic, identical output on repeated runs', () => {
    const input: FullOpportunityScoreInput = {
      demand: {
        clusterSize: 15,
        newQueries7d: 5,
        clusterGrowth30d: 0.6,
        expansionSlope30d: 0.4,
        attentionSourcesActive14d: 2,
        attentionGrowth14d: 0.3,
        historyDays: 35,
      },
      window: {
        serpWeakness: 72.5,
        eSpecialist30d: 0,
        eAuthoritative30d: 0,
        volatility30d: 1,
        crowdingIndex: 5,
        serpHistoryDays: 25,
        recentSerpSnapshotAvailable: true,
      },
      commercial: {
        band: 'HIGH',
        independentDomainsCount: 3,
        hasSubscriptionPlans: true,
        hasOneTimePlans: true,
        hasStrongNegative: false,
        totalScore: 8200,
      },
      confidence: {
        nIndependentSources: 3,
        totalEvidenceCount: 8,
        observedEvidenceCount: 6,
        medianEvidenceAgeDays: 12,
        historyDays: 35,
      },
      recommendation: {
        queryTypes: {
          informationalRatio: 0.3,
          commercialRatio: 0.4,
          transactionalRatio: 0.3,
          toolModifierRatio: 0.45,
          templateQueryCount: 5,
        },
        serpWeakness: 72.5,
        specialistToolCountInSerp: 2,
        authoritativeInTop3: false,
        commercialSummary: {
          band: 'HIGH',
          independentDomainsCount: 3,
          hasSubscriptionPlans: true,
          hasOneTimePlans: true,
          hasStrongNegative: false,
          totalScore: 8200,
        },
        dBand: 'HIGH',
        wBand: 'HIGH',
      },
    };

    const out1 = calculateOpportunityScore(input);
    const out2 = calculateOpportunityScore(input);

    assert.deepStrictEqual(out1, out2);
    assert.strictEqual(out1.verdict, 'BUILD_NOW');
    assert.strictEqual(out1.recommendedArchetype, 'TOOL');
  });

  it('supports Fast-Track 7-day qualification for breakout pulse momentum', () => {
    const demandRes = calculateDemandScore({
      clusterSize: 12,
      newQueries7d: 7,
      clusterGrowth30d: 1.5,
      expansionSlope30d: 0.8,
      attentionSourcesActive14d: 3,
      attentionGrowth14d: 0.5,
      historyDays: 7, // 7 days instead of 14
      fastTrack: true,
    });
    assert.strictEqual(demandRes.band, 'HIGH');
    assert.ok(demandRes.reason.includes('[FAST-TRACK]'));

    const windowRes = calculateWindowScore({
      serpWeakness: 75.0,
      eSpecialist30d: 0,
      eAuthoritative30d: 0,
      volatility30d: 2,
      crowdingIndex: 10,
      serpHistoryDays: 7, // 7 days SERP
      recentSerpSnapshotAvailable: true,
      fastTrack: true,
    });
    assert.strictEqual(windowRes.band, 'HIGH');

    const verdictRes = evaluateVerdict({
      dBand: demandRes.band,
      mSummary: {
        band: 'MEDIUM',
        independentDomainsCount: 1,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        hasTransactionTraction: true, // transaction traction observed
        totalScore: 6500,
      },
      wBand: windowRes.band,
      confidence: 'MEDIUM',
      historyDays: 7,
      fastTrack: true,
    });
    assert.strictEqual(verdictRes.rawVerdict, 'BUILD_NOW');
    assert.ok(verdictRes.rulesTriggered.includes('RULE_BUILD_NOW_COMPENSATED'));
    assert.ok(verdictRes.flags.includes('FAST_TRACK'));
  });

  it('triggers RULE_BUILD_NOW_COMPENSATED when breakout demand and open window compensate for developing commercial proof', () => {
    const verdictRes = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'MEDIUM',
        independentDomainsCount: 2,
        hasSubscriptionPlans: false,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        hasTransactionTraction: true,
        totalScore: 6000,
      },
      wBand: 'HIGH',
      confidence: 'MEDIUM',
      historyDays: 20,
    });
    assert.strictEqual(verdictRes.rawVerdict, 'BUILD_NOW');
    assert.ok(verdictRes.rulesTriggered.includes('RULE_BUILD_NOW_COMPENSATED'));
  });

  it('demotes pricing decoration without transaction traction from standard BUILD_NOW', () => {
    // Pricing decoration only (static pricing table, no reviews, no transactions)
    const decoratedRes = evaluateVerdict({
      dBand: 'MEDIUM',
      mSummary: {
        band: 'HIGH',
        independentDomainsCount: 2,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        pricingDecorationOnly: true, // decoration only
        hasTransactionTraction: false,
        totalScore: 7500,
      },
      wBand: 'MEDIUM',
      confidence: 'MEDIUM',
      historyDays: 30,
    });
    // Should NOT qualify for standard BUILD_NOW because mVerifiedStandard fails
    assert.notStrictEqual(decoratedRes.rawVerdict, 'BUILD_NOW');

    // But with transaction traction, it qualifies!
    const withTractionRes = evaluateVerdict({
      dBand: 'MEDIUM',
      mSummary: {
        band: 'HIGH',
        independentDomainsCount: 2,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        pricingDecorationOnly: true,
        hasTransactionTraction: true,
        totalScore: 7500,
      },
      wBand: 'MEDIUM',
      confidence: 'MEDIUM',
      historyDays: 30,
    });
    assert.strictEqual(withTractionRes.rawVerdict, 'BUILD_NOW');
    assert.ok(withTractionRes.rulesTriggered.includes('RULE_BUILD_NOW'));
  });

  it('triggers CROWDED_LOCKED circuit breaker and WINDOW_CLOSING when claim slots are full', () => {
    const crowdedRes = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'HIGH',
        independentDomainsCount: 3,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        totalScore: 8000,
      },
      wBand: 'HIGH',
      confidence: 'HIGH',
      historyDays: 35,
      claimsCount: 5,
      maxClaims: 5, // slots full
    });
    assert.strictEqual(crowdedRes.rawVerdict, 'WINDOW_CLOSING');
    assert.strictEqual(crowdedRes.verdict, 'WINDOW_CLOSING'); // debounce bypassed
    assert.ok(crowdedRes.flags.includes('CROWDED_LOCKED'));
    assert.ok(crowdedRes.rulesTriggered.includes('RULE_CROWDED_LOCKED'));
  });

  it('activates relaxed EARLY_BET for fast-track pulse with emerging signals', () => {
    const earlyRes = evaluateVerdict({
      dBand: 'MEDIUM',
      mSummary: {
        band: 'LOW',
        independentDomainsCount: 0,
        hasSubscriptionPlans: false,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        totalScore: 1000,
      },
      wBand: 'HIGH',
      confidence: 'LOW',
      historyDays: 8,
      fastTrack: true,
    });
    assert.strictEqual(earlyRes.rawVerdict, 'EARLY_BET');
    assert.ok(earlyRes.rulesTriggered.includes('RULE_EARLY_BET'));
    assert.ok(earlyRes.flags.includes('FAST_TRACK'));
  });

  // ---- 05 §5.0 publication gate -------------------------------------------

  it('forces WATCH when the observation has not cleared the baseline period', () => {
    const res = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'HIGH',
        independentDomainsCount: 3,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        totalScore: 7800,
      },
      wBand: 'HIGH',
      confidence: 'HIGH',
      historyDays: 6, // below the 14-day (and 7-day fast-track) baseline
    });
    assert.strictEqual(res.verdict, 'WATCH');
    assert.strictEqual(res.rawVerdict, 'WATCH');
    assert.strictEqual(res.publicationEligible, false);
    assert.ok(res.flags.includes('BASELINE_PERIOD'));
    assert.ok(res.flags.includes('PARTIAL_DATA'));
    assert.ok(res.rulesTriggered.includes('PUBLICATION_GATE_BLOCKED'));
  });

  it('forces WATCH when the commercial axis is inferred-only', () => {
    const res = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'LOW',
        independentDomainsCount: 0,
        hasSubscriptionPlans: false,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        inferredOnly: true,
        totalScore: 1000,
      },
      wBand: 'HIGH',
      confidence: 'HIGH',
      historyDays: 45,
    });
    assert.strictEqual(res.verdict, 'WATCH');
    assert.ok(res.flags.includes('M_INFERRED_ONLY'));
  });

  it('forces WATCH when the SERP history or latest snapshot is not usable', () => {
    const stale = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'HIGH',
        independentDomainsCount: 3,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        totalScore: 7800,
      },
      wBand: 'HIGH',
      confidence: 'HIGH',
      historyDays: 45,
      serpHistoryDays: 5,
      recentSerpSnapshotAvailable: false,
    });
    assert.strictEqual(stale.verdict, 'WATCH');
    assert.ok(stale.flags.includes('SERP_HISTORY_BELOW_BASELINE'));
    assert.ok(stale.flags.includes('NO_RECENT_ORGANIC_SERP'));
  });

  it('lets a fast-track pulse publish from 7 days of history', () => {
    const res = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'HIGH',
        independentDomainsCount: 3,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        totalScore: 7800,
      },
      wBand: 'MEDIUM',
      confidence: 'MEDIUM',
      historyDays: 8,
      fastTrack: true,
      serpHistoryDays: 7,
      recentSerpSnapshotAvailable: true,
    });
    assert.strictEqual(res.publicationEligible, true);
    assert.strictEqual(res.rawVerdict, 'BUILD_NOW');
  });

  it('still resolves a strong negative commercial signal to PASS', () => {
    const res = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'HIGH',
        independentDomainsCount: 3,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: true,
        totalScore: 900,
      },
      wBand: 'HIGH',
      confidence: 'HIGH',
      historyDays: 45,
      serpHistoryDays: 3,
      recentSerpSnapshotAvailable: false,
    });
    assert.strictEqual(res.verdict, 'PASS');
  });

  it('clamps the demand score to the 0-10000 basis-point range', () => {
    const res = calculateDemandScore({
      clusterSize: 12,
      newQueries7d: 20,
      clusterGrowth30d: 3,
      expansionSlope30d: 4,
      attentionSourcesActive14d: 4,
      attentionGrowth14d: 10, // unbounded heuristic term
      trendsSlope90d: 5,
      historyDays: 60,
    });
    assert.ok(res.basisPoints <= 10000, `expected <= 10000, got ${res.basisPoints}`);
    assert.ok(res.basisPoints >= 0);

    const clamped = calculateDemandScore(
      {
        clusterSize: 12,
        newQueries7d: 20,
        clusterGrowth30d: 3,
        expansionSlope30d: 4,
        attentionSourcesActive14d: 4,
        attentionGrowth14d: 10,
        historyDays: 60,
      },
      { newQueries: 900, growth: 900, expansion: 900, attention: 900 }
    );
    assert.ok(clamped.basisPoints <= 10000, `expected <= 10000, got ${clamped.basisPoints}`);
  });
});

describe('Verdict debounce and ledger prev-state (05 §5)', () => {
  const strongBuildAxes = {
    dBand: 'HIGH' as const,
    mSummary: {
      band: 'HIGH' as const,
      independentDomainsCount: 3,
      hasSubscriptionPlans: true,
      hasOneTimePlans: false,
      hasStrongNegative: false,
      totalScore: 7800,
    },
    wBand: 'HIGH' as const,
    confidence: 'HIGH' as const,
    historyDays: 45,
  };

  const weakAxes = {
    dBand: 'MEDIUM' as const,
    mSummary: {
      band: 'LOW' as const,
      independentDomainsCount: 0,
      hasSubscriptionPlans: false,
      hasOneTimePlans: false,
      hasStrongNegative: false,
      totalScore: 1200,
    },
    wBand: 'MEDIUM' as const,
    confidence: 'MEDIUM' as const,
    historyDays: 45,
  };

  it('upgrades to BUILD_NOW once the raw verdict has held for two days', () => {
    const prev = buildPrevScoringState({
      verdict: 'WATCH',
      rawVerdict: 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 2,
      daysInCurrentLifecycle: 2,
      wBandHistory: [],
    });
    const res = evaluateVerdict({ ...strongBuildAxes, prev });
    assert.strictEqual(res.rawVerdict, 'BUILD_NOW');
    assert.strictEqual(res.verdict, 'BUILD_NOW');
    assert.ok(res.rulesTriggered.includes('DEBOUNCE_UPGRADE_CONFIRMED'));
  });

  it('holds the previous verdict while an upgrade is still unconfirmed', () => {
    const prev = buildPrevScoringState({
      verdict: 'WATCH',
      rawVerdict: 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 1,
      daysInCurrentLifecycle: 1,
      wBandHistory: [],
    });
    const res = evaluateVerdict({ ...strongBuildAxes, prev });
    assert.strictEqual(res.rawVerdict, 'BUILD_NOW');
    assert.strictEqual(res.verdict, 'WATCH');
    assert.ok(res.rulesTriggered.includes('DEBOUNCE_UPGRADE_PENDING'));
  });

  it('never upgrades when prev.rawVerdict is the published value (the defect this fix removed)', () => {
    // observe-opportunity.ts used to write `rawVerdict: prev.verdict`, which made the
    // upgrade test at verdict.ts:219 unsatisfiable: the branch requires prev.verdict
    // !== raw, yet confirmation requires prev.rawVerdict === raw. This case pins that
    // shape so a regression is caught here rather than in production data.
    const prev = {
      ...buildPrevScoringState({
        verdict: 'WATCH',
        rawVerdict: null,
        lifecycle: 'EARLY_WINDOW',
        daysInCurrentVerdict: 5,
        daysInCurrentLifecycle: 5,
        wBandHistory: [],
      }),
      rawVerdict: 'WATCH' as const,
    };
    const res = evaluateVerdict({ ...strongBuildAxes, prev });
    assert.strictEqual(res.rawVerdict, 'BUILD_NOW');
    assert.strictEqual(res.verdict, 'WATCH');
    assert.ok(!res.rulesTriggered.includes('DEBOUNCE_UPGRADE_CONFIRMED'));
  });

  it('falls back to the published verdict for ledger rows predating raw_verdict', () => {
    const prev = buildPrevScoringState({
      verdict: 'WATCH',
      rawVerdict: null,
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 3,
      daysInCurrentLifecycle: 3,
      wBandHistory: [],
    });
    assert.strictEqual(prev.rawVerdict, 'WATCH');
    assert.strictEqual(prev.daysInCurrentVerdict, 3);
    assert.strictEqual(prev.daysInCurrentLifecycle, 3);
  });

  it('confirms a downgrade once the raw verdict has held for two days', () => {
    const prev = buildPrevScoringState({
      verdict: 'BUILD_NOW',
      rawVerdict: 'WATCH',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 2,
      daysInCurrentLifecycle: 2,
      wBandHistory: [],
    });
    const res = evaluateVerdict({ ...weakAxes, prev });
    assert.strictEqual(res.rawVerdict, 'WATCH');
    assert.strictEqual(res.verdict, 'WATCH');
    assert.ok(res.rulesTriggered.includes('DEBOUNCE_DOWNGRADE_CONFIRMED'));
  });

  it('holds BUILD_NOW while a downgrade is still unconfirmed', () => {
    const prev = buildPrevScoringState({
      verdict: 'BUILD_NOW',
      rawVerdict: 'WATCH',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 1,
      daysInCurrentLifecycle: 1,
      wBandHistory: [],
    });
    const res = evaluateVerdict({ ...weakAxes, prev });
    assert.strictEqual(res.rawVerdict, 'WATCH');
    assert.strictEqual(res.verdict, 'BUILD_NOW');
    assert.ok(res.rulesTriggered.includes('DEBOUNCE_DOWNGRADE_PENDING'));
  });

  it('upgrades through the compensated rule when demand and window compensate for medium M', () => {
    const prev = buildPrevScoringState({
      verdict: 'WATCH',
      rawVerdict: 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 2,
      daysInCurrentLifecycle: 2,
      wBandHistory: [],
    });
    const res = evaluateVerdict({
      ...strongBuildAxes,
      mSummary: {
        band: 'MEDIUM',
        independentDomainsCount: 2,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        totalScore: 6500,
      },
      prev,
    });
    assert.ok(res.rulesTriggered.includes('RULE_BUILD_NOW_COMPENSATED'));
    assert.strictEqual(res.verdict, 'BUILD_NOW');
  });
});

/**
 * 05 §5.1 必要条件 2：W 档必须在 obs_date 前 14 天内下降。
 *
 * 这条判据以前是"最后一格比第一格低"，而第一格可能是任意久远的读数——于是一次
 * 半年前的降档会在今天把机会判成 WINDOW_CLOSING。它的代价不只是标签错了：窗口
 * 关闭会改变公开投影与告警，等于把仍有抢跑价值的窗口提前泄露。
 */
describe('窗口关闭的新鲜度判据（05 §5.1 必要条件 2）', () => {
  const TODAY = '2026-06-01';
  const daysAgo = (n: number): string =>
    new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

  it('降档落在 14 天内才算，落在窗口外不算', () => {
    const fresh = [
      { obsDate: daysAgo(40), band: 'HIGH' as const },
      { obsDate: daysAgo(20), band: 'HIGH' as const },
      { obsDate: daysAgo(3), band: 'MEDIUM' as const },
    ];
    const ancient = [
      { obsDate: daysAgo(300), band: 'HIGH' as const },
      { obsDate: daysAgo(200), band: 'MEDIUM' as const },
      { obsDate: daysAgo(100), band: 'MEDIUM' as const },
    ];
    assert.strictEqual(wDroppedWithin(fresh, WINDOW_CLOSING_FRESHNESS_DAYS, TODAY), true);
    assert.strictEqual(wDroppedWithin(ancient, WINDOW_CLOSING_FRESHNESS_DAYS, TODAY), false);
  });

  it('只判定最近一次降档：更早的降档不影响结果', () => {
    const history = [
      { obsDate: daysAgo(120), band: 'HIGH' as const },
      { obsDate: daysAgo(100), band: 'LOW' as const },
      { obsDate: daysAgo(30), band: 'MEDIUM' as const }, // 最近一次是升档
    ];
    assert.strictEqual(wDroppedWithin(history, WINDOW_CLOSING_FRESHNESS_DAYS, TODAY), false);
  });

  it('降进 INSUFFICIENT 不算降档：那是数据缺失，不是市场结论', () => {
    const history = [
      { obsDate: daysAgo(10), band: 'HIGH' as const },
      { obsDate: daysAgo(3), band: 'INSUFFICIENT' as const },
    ];
    assert.strictEqual(wDroppedWithin(history, WINDOW_CLOSING_FRESHNESS_DAYS, TODAY), false);
  });

  it('历史不足两格或缺失时一律为假', () => {
    assert.strictEqual(wDroppedWithin(undefined, WINDOW_CLOSING_FRESHNESS_DAYS, TODAY), false);
    assert.strictEqual(wDroppedWithin([], WINDOW_CLOSING_FRESHNESS_DAYS, TODAY), false);
    assert.strictEqual(
      wDroppedWithin([{ obsDate: daysAgo(1), band: 'HIGH' }], WINDOW_CLOSING_FRESHNESS_DAYS, TODAY),
      false
    );
  });

  it('不读挂钟：缺省 asOf 时以历史最新一格的日期为今天', () => {
    const history = [
      { obsDate: daysAgo(30), band: 'HIGH' as const },
      { obsDate: daysAgo(2), band: 'MEDIUM' as const },
    ];
    // 同一输入重复调用必得同一结果，且与真实当前时间无关。
    assert.strictEqual(wDroppedWithin(history, WINDOW_CLOSING_FRESHNESS_DAYS), true);
    assert.strictEqual(wDroppedWithin(history, WINDOW_CLOSING_FRESHNESS_DAYS), true);
  });

  // ---- 端到端：判据如何改变裁决 -------------------------------------------
  const windowClosingAxes = {
    dBand: 'MEDIUM' as const,
    mSummary: {
      band: 'MEDIUM' as const,
      independentDomainsCount: 1,
      hasSubscriptionPlans: false,
      hasOneTimePlans: false,
      hasStrongNegative: false,
      totalScore: 4000,
    },
    wBand: 'LOW' as const,
    confidence: 'MEDIUM' as const,
    historyDays: 45,
  };

  const prevFromBuildNow = (dated: { obsDate: string; band: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' }[]) =>
    buildPrevScoringState({
      verdict: 'BUILD_NOW',
      rawVerdict: 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 30,
      daysInCurrentLifecycle: 30,
      // 无日期的序列仍然写着"HIGH -> MEDIUM"，旧实现正是靠它判定降档。
      wBandHistory: ['HIGH', 'HIGH', 'MEDIUM'],
      datedWBandHistory: dated,
    });

  it('14 天外的降档不再把机会锁进 WINDOW_CLOSING（本次修复的缺陷）', () => {
    const res = evaluateVerdict({
      ...windowClosingAxes,
      prev: prevFromBuildNow([
        { obsDate: daysAgo(300), band: 'HIGH' },
        { obsDate: daysAgo(200), band: 'MEDIUM' },
        { obsDate: daysAgo(100), band: 'MEDIUM' },
      ]),
      obsDate: TODAY,
    });
    assert.strictEqual(res.rawVerdict, 'PASS');
    assert.ok(!res.rulesTriggered.includes('RULE_WINDOW_CLOSING'));
  });

  it('14 天内的降档仍然触发 WINDOW_CLOSING', () => {
    const res = evaluateVerdict({
      ...windowClosingAxes,
      prev: prevFromBuildNow([
        { obsDate: daysAgo(40), band: 'HIGH' },
        { obsDate: daysAgo(20), band: 'HIGH' },
        { obsDate: daysAgo(3), band: 'MEDIUM' },
      ]),
      obsDate: TODAY,
    });
    assert.strictEqual(res.rawVerdict, 'WINDOW_CLOSING');
    assert.ok(res.rulesTriggered.includes('RULE_WINDOW_CLOSING'));
  });

  it('缺少带日期的历史时退回旧的无日期比较（仅为老调用方保留）', () => {
    const prev = buildPrevScoringState({
      verdict: 'BUILD_NOW',
      rawVerdict: 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 30,
      daysInCurrentLifecycle: 30,
      wBandHistory: ['HIGH', 'HIGH', 'MEDIUM'],
    });
    const res = evaluateVerdict({ ...windowClosingAxes, prev, obsDate: TODAY });
    assert.strictEqual(res.rawVerdict, 'WINDOW_CLOSING');
  });
});
