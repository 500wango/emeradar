import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  bandM,
  classifySnapshotDiff,
  countIndependentDomains,
  registrableDomain,
  COMMERCIAL_DEFAULTS,
  CommercialSummary,
  SnapshotDiffFacts,
} from '../src';

// 07-COMMERCIAL-SIGNAL-SPEC §13 acceptance matrix.
function summary(overrides: Partial<CommercialSummary> = {}): CommercialSummary {
  return {
    independentDomainsCount: 0,
    hasSubscriptionPlans: false,
    hasOneTimePlans: false,
    hasStrongNegative: false,
    totalScore: 0,
    band: 'INSUFFICIENT',
    sampledDomains: 5,
    sampleCoverage: 1,
    ...overrides,
  };
}

function facts(overrides: Partial<SnapshotDiffFacts> = {}): SnapshotDiffFacts {
  return {
    obsDate: '2026-10-05',
    plansCount: 2,
    paidPlansCount: 2,
    minPaidPrice: 19,
    gatewaysCount: 1,
    fetchTier: 'HEADLESS',
    dynamicShell: true,
    fetchStatus: 'OK',
    ...overrides,
  };
}

describe('M-axis banding (07 §6.1)', () => {
  it('payment provider only is INFRA_PRESENT and LOW, never a commercial proof', () => {
    const res = bandM(
      summary({ independentPricedDomains: 0, infraOnlyDomains: 2 })
    );
    assert.strictEqual(res.band, 'LOW');
    assert.strictEqual(res.stage, 'INFRA_PRESENT');
  });

  it('a single priced domain with no other evidence is LOW', () => {
    const res = bandM(summary({ independentPricedDomains: 1 }));
    assert.strictEqual(res.band, 'LOW');
  });

  it('two priced domains without revenue or persistence is MEDIUM and flagged decoration', () => {
    const res = bandM(summary({ independentPricedDomains: 2 }));
    assert.strictEqual(res.band, 'MEDIUM');
    assert.strictEqual(res.stage, 'PRICED');
    assert.strictEqual(res.pricingDecorationOnly, true);
  });

  it('two priced domains plus 90-day persistence reaches HIGH', () => {
    const res = bandM(
      summary({ independentPricedDomains: 2, persistentPricedDomains: 1 })
    );
    assert.strictEqual(res.band, 'HIGH');
    assert.strictEqual(res.stage, 'PAID_PERSISTENT');
    assert.strictEqual(res.pricingDecorationOnly, false);
  });

  it('self-reported revenue with a single priced domain must not reach HIGH', () => {
    const res = bandM(
      summary({
        independentPricedDomains: 1,
        revenueEvidence: { observed: 0, selfReported: 3 },
      })
    );
    assert.notStrictEqual(res.band, 'HIGH');
    assert.strictEqual(res.stage, 'REVENUE_EVIDENCED');
  });

  it('third-party estimates without OBSERVED supply do not band above LOW', () => {
    // THIRD_PARTY_ESTIMATE is deliberately not an input to bandM (07 §6.1).
    const res = bandM(summary({ independentPricedDomains: 0 }));
    assert.ok(res.band === 'LOW' || res.band === 'INSUFFICIENT');
  });

  it('an opportunity that was never sampled is INSUFFICIENT, not LOW', () => {
    const res = bandM(summary({ sampledDomains: 0, sampleCoverage: 0 }));
    assert.strictEqual(res.band, 'INSUFFICIENT');
  });

  it('sampling targets that all read back empty is a finding, so LOW', () => {
    const res = bandM(summary({ sampledDomains: 4, sampleCoverage: 1 }));
    assert.strictEqual(res.band, 'LOW');
  });

  it('priced evidence observed before the target-link table existed still bands', () => {
    const res = bandM(
      summary({ independentPricedDomains: 2, sampledDomains: 0, sampleCoverage: 0 })
    );
    assert.strictEqual(res.band, 'MEDIUM');
  });

  it('records an under-sampled opportunity without demoting it (phase 1)', () => {
    const res = bandM(
      summary({ independentPricedDomains: 2, sampledDomains: 2, sampleCoverage: 0.4 })
    );
    assert.strictEqual(res.coverageInsufficient, true);
    assert.strictEqual(res.band, 'MEDIUM');
  });

  it('demotes to INSUFFICIENT once the coverage gate is enforced (phase 2)', () => {
    const res = bandM(
      summary({ independentPricedDomains: 2, sampledDomains: 2, sampleCoverage: 0.4 }),
      { ...COMMERCIAL_DEFAULTS, enforceCoverageGate: true }
    );
    assert.strictEqual(res.band, 'INSUFFICIENT');
  });

  it('reports how many more days persistence still needs during cold start', () => {
    const res = bandM(summary({ independentPricedDomains: 2, maxSnapshotSpanDays: 40 }));
    assert.strictEqual(res.persistenceDaysNeeded, 50);
  });

  it('a strong negative across two independent domains downgrades one band and raises the flag', () => {
    const res = bandM(
      summary({
        independentPricedDomains: 2,
        persistentPricedDomains: 1,
        negatives: [{ type: 'NEG_PRICING_REMOVED', domains: 2, strong: false }],
      })
    );
    assert.strictEqual(res.hasStrongNegative, true);
    assert.strictEqual(res.band, 'MEDIUM');
    assert.strictEqual(res.downgraded, true);
    assert.match(res.reason, /Downgraded one band/);
  });

  it('a single-domain removal is a negative but not a strong one', () => {
    const res = bandM(
      summary({
        independentPricedDomains: 2,
        negatives: [{ type: 'NEG_PRICING_REMOVED', domains: 1, strong: false }],
      })
    );
    assert.strictEqual(res.hasStrongNegative, false);
    assert.strictEqual(res.downgraded, false);
    assert.strictEqual(res.negativeReasons.length, 1);
  });

  it('a shutdown notice on one direct competitor is strong immediately', () => {
    const res = bandM(
      summary({
        independentPricedDomains: 2,
        negatives: [{ type: 'NEG_SHUTDOWN_NOTICE', domains: 1, strong: false }],
      })
    );
    assert.strictEqual(res.hasStrongNegative, true);
  });

  it('is deterministic', () => {
    const input = summary({ independentPricedDomains: 3, persistentPricedDomains: 2 });
    assert.deepStrictEqual(bandM(input), bandM(input));
  });
});

describe('domain independence (07 §8, conservative)', () => {
  it('collapses subdomains to the registrable domain', () => {
    assert.strictEqual(registrableDomain('app.notion.so'), 'notion.so');
    assert.strictEqual(registrableDomain('WWW.Foo.com'), 'foo.com');
  });

  it('keeps multi-part public suffixes intact', () => {
    assert.strictEqual(registrableDomain('shop.example.co.uk'), 'example.co.uk');
    assert.strictEqual(registrableDomain('a.b.example.com.cn'), 'example.com.cn');
  });

  it('counts two hosts under one eTLD+1 as a single domain', () => {
    assert.strictEqual(
      countIndependentDomains(['buy.toolapp.com', 'docs.toolapp.com', 'other.com']),
      2
    );
  });
});

describe('commercial snapshot diffing (07 §11 step 5, §11.1)', () => {
  it('paid plans disappearing on an authoritative read is NEG_PRICING_REMOVED', () => {
    const res = classifySnapshotDiff(facts(), facts({ plansCount: 0, paidPlansCount: 0, minPaidPrice: null }));
    assert.strictEqual(res.negative, 'NEG_PRICING_REMOVED');
  });

  it('an empty Tier-1 read on a never-upgraded SPA shell concludes nothing', () => {
    const res = classifySnapshotDiff(
      facts(),
      facts({ plansCount: 0, paidPlansCount: 0, minPaidPrice: null, fetchTier: 'STATIC', dynamicShell: true })
    );
    assert.strictEqual(res.negative, undefined);
    assert.strictEqual(res.suppressed, 'TIER1_EMPTY_NOT_UPGRADED');
  });

  it('paid plans turning free is NEG_PAID_TO_FREE', () => {
    const res = classifySnapshotDiff(facts(), facts({ paidPlansCount: 0, minPaidPrice: null }));
    assert.strictEqual(res.negative, 'NEG_PAID_TO_FREE');
  });

  it('a fetch-tier flip alone is never a negative signal', () => {
    const res = classifySnapshotDiff(facts(), facts({ fetchTier: 'STATIC' }));
    assert.strictEqual(res.negative, undefined);
    assert.strictEqual(res.suppressed, 'TIER_CHANGE_ONLY');
    assert.strictEqual(res.fetchTierChangedOnly, true);
  });

  it('flags a price move beyond 30%', () => {
    const res = classifySnapshotDiff(facts({ minPaidPrice: 20 }), facts({ minPaidPrice: 12 }));
    assert.strictEqual(res.priceChangeMajor, true);
    assert.strictEqual(res.priceChangePct, -40);
  });

  it('does not treat a failed fetch as pricing removal', () => {
    const res = classifySnapshotDiff(facts(), facts({ fetchStatus: 'FAILED', plansCount: 0, paidPlansCount: 0 }));
    assert.strictEqual(res.negative, undefined);
    assert.strictEqual(res.suppressed, 'CURRENT_NOT_OK');
  });

  it('has nothing to diff against on a target first seen today', () => {
    const res = classifySnapshotDiff(null, facts({ plansCount: 0, paidPlansCount: 0 }));
    assert.strictEqual(res.negative, undefined);
    assert.strictEqual(res.suppressed, 'NO_PRIOR_SNAPSHOT');
  });
});
