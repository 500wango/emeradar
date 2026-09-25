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
    assert.strictEqual(out1.recommendedArchetype, 'LIGHTWEIGHT_TOOL');
  });
});
