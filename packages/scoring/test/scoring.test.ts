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
  WindowFeatures,
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

  it('staleSources 打 STALE_DATA 标志，但不改变裁决', () => {
    const base = {
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
    const fresh = evaluateVerdict(base);
    const stale = evaluateVerdict({ ...base, staleSources: ['SERP'] });
    assert.ok(stale.flags.includes('STALE_DATA'));
    assert.strictEqual(stale.verdict, fresh.verdict);
  });

  // v3.1 黄金用例 3：补偿路径不接受"只有多站静态定价"的 MEDIUM。
  it('caps two decoration-priced domains at EARLY_BET: no compensation without traction or persistence (PRD v2.2 Q1)', () => {
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
    assert.strictEqual(res.rawVerdict, 'EARLY_BET');
    assert.ok(!res.rulesTriggered.includes('RULE_BUILD_NOW_COMPENSATED'));
    assert.ok(!res.rulesTriggered.includes('RULE_BUILD_NOW'));
  });

  it('compensates a MEDIUM M that carries persistent pricing (>= 90 days) even without traction (Q1)', () => {
    const res = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'MEDIUM',
        independentDomainsCount: 2,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        persistentPricedDomains: 1,
        totalScore: 6500,
      },
      wBand: 'HIGH',
      confidence: 'HIGH',
      historyDays: 30,
    });
    assert.strictEqual(res.rawVerdict, 'BUILD_NOW');
    assert.ok(res.rulesTriggered.includes('RULE_BUILD_NOW_COMPENSATED'));
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

  it('publishes EARLY_BET, never BUILD_NOW, when the commercial axis is inferred-only (PRD §5.7, 30 R6)', () => {
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
    assert.strictEqual(res.publicationEligible, true);
    assert.strictEqual(res.verdict, 'EARLY_BET');
    assert.ok(!res.flags.includes('M_INFERRED_ONLY'));
    assert.ok(!res.rulesTriggered.some((r) => r.startsWith('RULE_BUILD_NOW')));
  });

  it('keeps inferred-only out of BUILD_NOW even when the other axes are maximal', () => {
    const res = evaluateVerdict({
      dBand: 'HIGH',
      mSummary: {
        band: 'HIGH',
        independentDomainsCount: 3,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        inferredOnly: true,
        totalScore: 7800,
      },
      wBand: 'HIGH',
      confidence: 'HIGH',
      historyDays: 45,
    });
    assert.notStrictEqual(res.rawVerdict, 'BUILD_NOW');
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
        hasTransactionTraction: true,
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

  const prevFromBuildNow = (
    dated: { obsDate: string; band: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' }[],
    overrides: { rawVerdict?: 'BUILD_NOW' | 'EARLY_BET' | 'WATCH' | 'PASS' | 'WINDOW_CLOSING'; daysInCurrentVerdict?: number } = {}
  ) =>
    buildPrevScoringState({
      verdict: 'BUILD_NOW',
      rawVerdict: overrides.rawVerdict ?? 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: overrides.daysInCurrentVerdict ?? 30,
      daysInCurrentLifecycle: 30,
      wBandHistory: ['HIGH', 'HIGH', 'MEDIUM'],
      // v3.1：拥挤度退出 W，展示用 W 与市场 W 恒等，一条带日期的序列即可。
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

  it('14 天内的降档，且当前 W ≥ MEDIUM → WINDOW_CLOSING（05 §5.1 必要条件 2）', () => {
    const res = evaluateVerdict({
      ...windowClosingAxes,
      wBand: 'MEDIUM', // 必要条件 3：当前 W 仍 ≥ MEDIUM
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

  it('14 天内降档但当前 W=LOW → PASS（v3.1 黄金用例 2：先命中 PASS，不再叠加 WINDOW_CLOSING）', () => {
    const res = evaluateVerdict({
      ...windowClosingAxes,
      wBand: 'LOW',
      // 降档已确认：上一期的 raw 也是 PASS，去抖不再把发布值留在 BUILD_NOW。
      prev: prevFromBuildNow(
        [
          { obsDate: daysAgo(40), band: 'HIGH' },
          { obsDate: daysAgo(20), band: 'HIGH' },
          { obsDate: daysAgo(3), band: 'MEDIUM' },
        ],
        { rawVerdict: 'PASS', daysInCurrentVerdict: 2 }
      ),
      obsDate: TODAY,
    });
    assert.strictEqual(res.rawVerdict, 'PASS');
    assert.strictEqual(res.verdict, 'PASS');
    assert.ok(!res.rulesTriggered.includes('RULE_WINDOW_CLOSING'));
    assert.ok(!res.flags.includes('W_DROPPING'), 'PASS 已经消费了这次降档');
  });

  it('此前从未发布过 BUILD_NOW / EARLY_BET 时不判 WINDOW_CLOSING：没开过的窗谈不上关闭', () => {
    const prev = buildPrevScoringState({
      verdict: 'WATCH',
      rawVerdict: 'WATCH',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 30,
      daysInCurrentLifecycle: 30,
      wBandHistory: ['HIGH', 'HIGH', 'MEDIUM'],
      datedWBandHistory: [
        { obsDate: daysAgo(40), band: 'HIGH' },
        { obsDate: daysAgo(3), band: 'MEDIUM' },
      ],
    });
    const res = evaluateVerdict({ ...windowClosingAxes, wBand: 'MEDIUM', prev, obsDate: TODAY });
    assert.notStrictEqual(res.rawVerdict, 'WINDOW_CLOSING');
  });

  it('没有带日期的 W 历史时不判定降档：宁可漏报，不误报', () => {
    const prev = buildPrevScoringState({
      verdict: 'BUILD_NOW',
      rawVerdict: 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 30,
      daysInCurrentLifecycle: 30,
      wBandHistory: ['HIGH', 'HIGH', 'MEDIUM'],
    });
    const res = evaluateVerdict({ ...windowClosingAxes, wBand: 'MEDIUM', prev, obsDate: TODAY });
    assert.notStrictEqual(res.rawVerdict, 'WINDOW_CLOSING');
  });

  it('三个拥挤透明度字段变化不改变 W_score 与 raw_verdict（v3.1 黄金用例 1）', () => {
    const baseWindow: WindowFeatures = {
      serpWeakness: 72.5,
      eSpecialist30d: 0,
      eAuthoritative30d: 0,
      volatility30d: 1,
      serpHistoryDays: 25,
      recentSerpSnapshotAvailable: true,
    };
    // 旧口径下的拥挤/槽位输入即使被调用方塞回来，也不得进入公式或裁决。
    const withCrowding = {
      ...baseWindow,
      crowdingIndex: 42,
      claimsCount: 9,
      maxClaims: 9,
      isCrowdedLocked: true,
      verifiedProductCount: 9,
      top10SpecialistCount: 7,
      newTop10Entrants30d: 5,
    } as unknown as WindowFeatures;

    const plainW = calculateWindowScore(baseWindow);
    const crowdedW = calculateWindowScore(withCrowding);
    assert.strictEqual(crowdedW.basisPoints, plainW.basisPoints);
    assert.strictEqual(crowdedW.band, plainW.band);

    const baseInput: FullOpportunityScoreInput = {
      demand: {
        clusterSize: 15,
        newQueries7d: 5,
        clusterGrowth30d: 0.6,
        expansionSlope30d: 0.4,
        attentionSourcesActive14d: 2,
        attentionGrowth14d: 0.3,
        historyDays: 35,
      },
      window: baseWindow,
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
      obsDate: TODAY,
    };

    const plain = calculateOpportunityScore(baseInput);
    const crowded = calculateOpportunityScore({ ...baseInput, window: withCrowding });
    assert.strictEqual(crowded.wScore, plain.wScore);
    assert.strictEqual(crowded.wBand, plain.wBand);
    assert.strictEqual(crowded.marketWBand, crowded.wBand, 'marketWBand 必须等于 wBand');
    assert.strictEqual(crowded.rawVerdict, plain.rawVerdict);
    assert.strictEqual(crowded.verdict, plain.verdict);
  });

  it('W 公式只剩 SERP 脆弱度与在位压力：拥挤项已剔除（05 §3.3）', () => {
    // pressure = 30·0 + 40·0 + 3·2 = 6；(0.6·75 + 0.25·94) / 0.85 = 80.588 → 8059 bp
    const open = calculateWindowScore({
      serpWeakness: 75,
      eSpecialist30d: 0,
      eAuthoritative30d: 0,
      volatility30d: 2,
      serpHistoryDays: 30,
      recentSerpSnapshotAvailable: true,
    });
    assert.strictEqual(open.basisPoints, 8059);
    assert.strictEqual(open.band, 'HIGH');

    // 无 SERP 历史时仍是 INSUFFICIENT，与公式改动无关。
    const insufficient = calculateWindowScore({
      serpWeakness: 75,
      eSpecialist30d: 0,
      eAuthoritative30d: 0,
      volatility30d: 2,
      serpHistoryDays: 5,
      recentSerpSnapshotAvailable: true,
    });
    assert.strictEqual(insufficient.band, 'INSUFFICIENT');
    assert.strictEqual(insufficient.basisPoints, 0);
  });

  it('W 在 14 天内降档、最终仍是 BUILD_NOW 时打 W_DROPPING', () => {
    const prev = buildPrevScoringState({
      verdict: 'WATCH',
      // 升级已确认（上一期 raw 就是 BUILD_NOW 且已连续两天），发布值不再是 WATCH。
      rawVerdict: 'BUILD_NOW',
      lifecycle: 'EARLY_WINDOW',
      daysInCurrentVerdict: 2,
      daysInCurrentLifecycle: 5,
      wBandHistory: ['HIGH', 'HIGH', 'MEDIUM'],
      datedWBandHistory: [
        { obsDate: daysAgo(10), band: 'HIGH' },
        { obsDate: daysAgo(2), band: 'MEDIUM' },
      ],
    });
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
      prev,
      obsDate: TODAY,
    });
    assert.strictEqual(res.rawVerdict, 'BUILD_NOW');
    assert.strictEqual(res.verdict, 'BUILD_NOW');
    assert.ok(res.flags.includes('W_DROPPING'));
  });

  it('W_DROPPING 后置：最终裁决是 WINDOW_CLOSING 时不打（避免"已关窗"与"在降"同时出现）', () => {
    const res = evaluateVerdict({
      ...windowClosingAxes,
      wBand: 'MEDIUM',
      // 降档已确认：上一期 raw 就是 WINDOW_CLOSING，发布值随之落到 WINDOW_CLOSING。
      prev: prevFromBuildNow(
        [
          { obsDate: daysAgo(10), band: 'HIGH' },
          { obsDate: daysAgo(2), band: 'MEDIUM' },
        ],
        { rawVerdict: 'WINDOW_CLOSING', daysInCurrentVerdict: 2 }
      ),
      obsDate: TODAY,
    });
    assert.strictEqual(res.rawVerdict, 'WINDOW_CLOSING');
    assert.strictEqual(res.verdict, 'WINDOW_CLOSING');
    assert.ok(!res.flags.includes('W_DROPPING'));
  });
});

/**
 * v3.1 生命周期：`EARLY_WINDOW → CONTESTED` 除了"强站进 Top10"，还要消费
 * `verified_product_count ≥ 3` 与"W 在 14 天内降档"。这两个输入只进生命周期，不进 W。
 */
describe('生命周期的 v3.1 判据（05 §3.3）', () => {
  const base = {
    dBand: 'MEDIUM' as const,
    wBand: 'MEDIUM' as const,
    eSpecialist30d: 0,
    eAuthoritative30d: 0,
    volatility30d: 1,
    expansionSlope30d: 0.3,
    newQueries7d: 4,
  };
  const inEarlyWindow = buildPrevScoringState({
    verdict: 'BUILD_NOW',
    rawVerdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    daysInCurrentVerdict: 5,
    daysInCurrentLifecycle: 5,
    wBandHistory: ['MEDIUM'],
  });

  it('没有任何竞争信号时保持在 EARLY_WINDOW', () => {
    const res = evaluateLifecycle({ ...base, prev: inEarlyWindow, verifiedProductCount: 2 });
    assert.strictEqual(res.state, 'EARLY_WINDOW');
  });

  it('W 在 14 天内降档 → CONTESTED', () => {
    const res = evaluateLifecycle({ ...base, prev: inEarlyWindow, wDroppedWithinWindow: true });
    assert.strictEqual(res.state, 'CONTESTED');
  });

  it('已验证产品数达到 3 → CONTESTED', () => {
    const res = evaluateLifecycle({ ...base, prev: inEarlyWindow, verifiedProductCount: 3 });
    assert.strictEqual(res.state, 'CONTESTED');
  });
});
