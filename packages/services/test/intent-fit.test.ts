import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateIntentFit } from '../src/intent-fit.service';

/**
 * 意图判断用可观测证据，不用 LLM：
 *   - 词面修饰词（可枚举）
 *   - Top10 里专属产品页的占比（SERP 形态）
 *   - 前排是否有人收费（商业存在性）
 *
 * 输出三档，`INSUFFICIENT` 是合法结论——不知道就说不知道。
 */
describe('意图适配 intent_fit', () => {
  it('工具页为主 + 有人收费 → TOOL_INTENT', () => {
    const d = evaluateIntentFit({
      query: 'invoice generator',
      pageKinds: ['DEDICATED_TOOL', 'DEDICATED_TOOL', 'DEDICATED_TOOL', 'CONTENT'],
      pricedDomains: 2,
      blockedDomains: 0,
      probedDomains: 3,
    });
    assert.strictEqual(d.intentFit, 'TOOL_INTENT');
    assert.ok(d.score >= 0.5);
  });

  it('UGC/内容/泛平台占满、没人收费 → INFORMATIONAL', () => {
    // 这是 podcast transcript seo 的实际形态：LinkedIn 帖子、Quora、Wix、托管商。
    const d = evaluateIntentFit({
      query: 'podcast transcript seo',
      pageKinds: ['UGC', 'DEDICATED_TOOL', 'UGC', 'GENERIC_PLATFORM', 'DEDICATED_TOOL', 'UGC', 'HOSTING_SERVICE', 'CONTENT'],
      pricedDomains: 1,
      blockedDomains: 0,
      probedDomains: 3,
    });
    assert.strictEqual(d.intentFit, 'INFORMATIONAL');
    assert.match(d.reason, /informational/i);
  });

  it('明确信息型前缀即使有工具页也判 INFORMATIONAL', () => {
    const d = evaluateIntentFit({
      query: 'how to convert csv to excel',
      pageKinds: ['DEDICATED_TOOL', 'DEDICATED_TOOL', 'CONTENT'],
      pricedDomains: 1,
      blockedDomains: 0,
      probedDomains: 3,
    });
    assert.strictEqual(d.intentFit, 'INFORMATIONAL');
  });

  it('没有 SERP 时不硬判，返回 INSUFFICIENT', () => {
    const d = evaluateIntentFit({ query: 'anything', pageKinds: [], pricedDomains: 0, blockedDomains: 0 });
    assert.strictEqual(d.intentFit, 'INSUFFICIENT');
    assert.strictEqual(d.signals.distinctDomains, 0);
  });

  it('混合形态 + 有域名被拦截 → INSUFFICIENT，不猜', () => {
    const d = evaluateIntentFit({
      query: 'pdf tool',
      pageKinds: ['DEDICATED_TOOL', 'UGC', 'DOC', 'CONTENT', 'GENERIC_PLATFORM'],
      pricedDomains: 0,
      blockedDomains: 2,
      probedDomains: 2,
    });
    assert.strictEqual(d.intentFit, 'INSUFFICIENT');
    assert.match(d.reason, /could not be observed/i);
  });

  it('没有工具页、也一次都没探测定价 → INSUFFICIENT（不能把“没查”说成“没需求”）', () => {
    const d = evaluateIntentFit({
      query: 'podcast transcript seo',
      pageKinds: ['UGC', 'UNCLASSIFIED', 'UGC', 'GENERIC_PLATFORM', 'UNCLASSIFIED', 'UGC', 'HOSTING_SERVICE'],
      pricedDomains: 0,
      blockedDomains: 0,
      probedDomains: 0,
    });
    assert.strictEqual(d.intentFit, 'INSUFFICIENT');
    assert.match(d.reason, /no competitor pricing was probed/i);
  });

  it('判定是确定性的，并带规则版本', () => {
    const input = {
      query: 'csv to json',
      pageKinds: ['DEDICATED_TOOL', 'CONTENT'],
      pricedDomains: 0,
      blockedDomains: 0,
      probedDomains: 2,
    };
    assert.deepStrictEqual(evaluateIntentFit(input), evaluateIntentFit(input));
    assert.strictEqual(evaluateIntentFit(input).ruleVersion, 'intent-fit-v1');
  });
});
