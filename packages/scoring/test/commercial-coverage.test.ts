import { describe, it } from 'node:test';
import assert from 'node:assert';
import { bandM, COMMERCIAL_DEFAULTS, CommercialSummary } from '../src';

/**
 * 审计问题 06（P1）：enforceCoverageGate=false 时，抽样覆盖不足的机会仍可能
 * 挂上 HIGH 的「高可信商业」标签。修复：Gate 保持默认关闭（避免 Feed 干涸，
 * 影子统计确认误杀率前不开启），但覆盖不足的机会一律封顶 MEDIUM，
 * 并给出 commercialVerification='PENDING' 的「待验证」分层。
 */
describe('商业抽样覆盖的「待验证」分层（审计 06）', () => {
  const strong: Partial<CommercialSummary> = {
    independentPricedDomains: 2,
    persistentPricedDomains: 1,
  };

  function summary(overrides: Partial<CommercialSummary> = {}): CommercialSummary {
    return {
      independentDomainsCount: 2,
      hasSubscriptionPlans: true,
      hasOneTimePlans: false,
      hasStrongNegative: false,
      totalScore: 8200,
      band: 'HIGH',
      sampledDomains: 5,
      sampleCoverage: 1,
      ...overrides,
    };
  }

  it('覆盖充足 + 持久付费：HIGH，商业结论 VERIFIED', () => {
    const res = bandM(summary(strong));
    assert.strictEqual(res.band, 'HIGH');
    assert.strictEqual(res.commercialVerification, 'VERIFIED');
    assert.strictEqual(res.coverageInsufficient, false);
  });

  it('覆盖不足：封顶 MEDIUM，商业结论 PENDING，理由说明待验证', () => {
    const res = bandM(summary({ ...strong, sampledDomains: 2, sampleCoverage: 0.4 }));
    assert.strictEqual(res.band, 'MEDIUM', '未验证的结论不得挂 HIGH');
    assert.strictEqual(res.commercialVerification, 'PENDING');
    assert.strictEqual(res.coverageInsufficient, true);
    assert.match(res.reason, /pending|verif/i);
  });

  it('显式开启 enforceCoverageGate：维持既有 INSUFFICIENT 行为', () => {
    const res = bandM(summary({ ...strong, sampledDomains: 2, sampleCoverage: 0.4 }), {
      ...COMMERCIAL_DEFAULTS,
      enforceCoverageGate: true,
    });
    assert.strictEqual(res.band, 'INSUFFICIENT');
    assert.strictEqual(res.commercialVerification, 'PENDING');
  });

  it('从未抽样（无覆盖数据）不触发封顶：存量调用方兼容', () => {
    const res = bandM(
      summary({ ...strong, sampledDomains: undefined, sampleCoverage: undefined })
    );
    assert.strictEqual(res.band, 'HIGH');
    assert.strictEqual(res.commercialVerification, 'VERIFIED');
  });
});
