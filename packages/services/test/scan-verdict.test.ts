import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateScanVerdict, suggestAlternatives } from '../src/scan-verdict.service';
import type { IntentDecision } from '../src/intent-fit.service';

/**
 * 扫码必须当天给出三态之一：做 / 不做 / 还不行。
 *
 * 这是产品底线：用户问的是“能不能做”，不是“SERP 长什么样”。
 * `还不行` 必须说明缺什么，否则等于没说。
 */
function intent(fit: IntentDecision['intentFit'], overrides: Partial<IntentDecision['signals']> = {}): IntentDecision {
  return {
    intentFit: fit,
    score: 0.5,
    signals: {
      toolModifier: false,
      informationalModifier: false,
      dedicatedToolPages: 0,
      distinctDomains: 0,
      toolPageShare: 0,
      pricedDomains: 0,
      blockedDomains: 0,
      probedDomains: 0,
      vendorIntent: null,
      ...overrides,
    },
    reason: 'test',
    ruleVersion: 'intent-fit-v1',
  };
}

describe('扫码三态判断', () => {
  it('信息型 → 当天判“不做”，并给替代词', () => {
    const result = evaluateScanVerdict({
      query: 'podcast transcript seo',
      intent: intent('INFORMATIONAL', { dedicatedToolPages: 0, distinctDomains: 8, probedDomains: 3 }),
      priced: [],
      probedDomains: 3,
      blockedDomains: 0,
      competitors: 6,
      weakDomains: 3,
      dedicatedToolPages: 0,
    });
    assert.strictEqual(result.verdict, 'DO_NOT_BUILD');
    assert.match(result.headline, /不做/);
    assert.ok(result.reasons.length >= 2);
    assert.ok(result.alternatives.length > 0, '不做时必须给出该看什么');
    assert.ok(result.alternatives.every((a) => a.query !== 'podcast transcript seo'));
  });

  it('工具型 + 有人收费 + 前排可穿透 → 判“做”，并给切法', () => {
    const result = evaluateScanVerdict({
      query: 'podcast show notes generator',
      intent: intent('TOOL_INTENT', { dedicatedToolPages: 3, distinctDomains: 6, pricedDomains: 2, probedDomains: 3 }),
      priced: [
        { domain: 'a.example', minPrice: 9, currency: '$' },
        { domain: 'b.example', minPrice: 29, currency: '$' },
      ],
      probedDomains: 3,
      blockedDomains: 0,
      competitors: 6,
      weakDomains: 3,
      dedicatedToolPages: 3,
    });
    assert.strictEqual(result.verdict, 'BUILD');
    assert.match(result.headline, /可以做/);
    assert.ok(result.angle, '该做时必须说明怎么切');
    assert.deepStrictEqual(result.alternatives, []);
  });

  it('工具型但没人收费且前排不弱 → 还不行，并说明缺什么', () => {
    const result = evaluateScanVerdict({
      query: 'obscure tool',
      intent: intent('TOOL_INTENT', { dedicatedToolPages: 2, distinctDomains: 8, probedDomains: 3 }),
      priced: [],
      probedDomains: 3,
      blockedDomains: 0,
      competitors: 8,
      weakDomains: 1,
      dedicatedToolPages: 2,
    });
    assert.strictEqual(result.verdict, 'NOT_YET');
    assert.ok(result.needs && result.needs.length > 0, '还不行必须说明缺什么');
  });

  it('证据不足 → 还不行，且指出“没做过定价探测”', () => {
    const result = evaluateScanVerdict({
      query: 'unknown query',
      intent: intent('INSUFFICIENT'),
      priced: [],
      probedDomains: 0,
      blockedDomains: 0,
      competitors: 0,
      weakDomains: 0,
      dedicatedToolPages: 0,
    });
    assert.strictEqual(result.verdict, 'NOT_YET');
    assert.ok(result.reasons.some((r) => /定价探测/.test(r.text)));
    assert.match(result.needs ?? '', /重新扫一次/);
  });

  it('三态只有三种，且每个结论都可核对', () => {
    const verdicts = new Set<string>();
    for (const fit of ['TOOL_INTENT', 'INFORMATIONAL', 'INSUFFICIENT'] as const) {
      const result = evaluateScanVerdict({
        query: 'q',
        intent: intent(fit, { dedicatedToolPages: 2, distinctDomains: 5, probedDomains: 2 }),
        priced: [{ domain: 'a.example', minPrice: 9, currency: '$' }],
        probedDomains: 2,
        blockedDomains: 0,
        competitors: 5,
        weakDomains: 2,
        dedicatedToolPages: 2,
      });
      verdicts.add(result.verdict);
      assert.ok(result.reasons.length > 0, '每个结论都要有依据');
    }
    assert.ok([...verdicts].every((v) => ['BUILD', 'DO_NOT_BUILD', 'NOT_YET'].includes(v)));
  });
});

describe('替代词建议', () => {
  it('优先用库里已观测的同族词，并标注来源', () => {
    const alt = suggestAlternatives('podcast transcript seo', ['podcast show notes generator']);
    assert.strictEqual(alt[0].query, 'podcast show notes generator');
    assert.match(alt[0].why, /库里/);
  });

  it('没有已知词时用词根 + 工具后缀，并明确是启发式', () => {
    const alt = suggestAlternatives('podcast transcript seo');
    assert.ok(alt.length > 0);
    assert.ok(alt.every((a) => /启发式/.test(a.why)));
    assert.ok(alt.every((a) => a.query !== 'podcast transcript seo'));
  });
});
