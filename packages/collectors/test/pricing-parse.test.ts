import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CrawlCollector } from '../src';

/**
 * 价格解析回归。
 *
 * 曾经把「命中的金额」当成货币符号，界面因此渲染出 `Starter 8.998.99`。
 * 这类错误比没有价格更糟：用户会以为系统读懂了页面。
 */
const collector = new CrawlCollector();

function plans(html: string) {
  return collector.extractPricingPlans(html);
}

describe('价格解析', () => {
  it('货币由命中的分支决定，不取金额', () => {
    const [plan] = plans(`<div><h2>Starter</h2><span>$8.99/mo</span></div>`);
    assert.strictEqual(plan.currency, '$');
    assert.strictEqual(plan.priceMonthly, 8.99);
  });

  it('欧元用逗号小数：8,99 是 8.99，不是 899', () => {
    const [plan] = plans(`<div><h2>Starter</h2><span>€8,99/Monat</span></div>`);
    assert.strictEqual(plan.currency, '€');
    assert.strictEqual(plan.priceMonthly, 8.99);
  });

  it('英语千分位：1,299 是 1299，不是 1.299', () => {
    const [plan] = plans(`<div><h2>Pro</h2><span>$1,299/year</span></div>`);
    assert.strictEqual(plan.currency, '$');
    assert.strictEqual(plan.priceYearly, 1299);
  });

  it('金额在前、货币词在后', () => {
    const [plan] = plans(`<div><h2>Business</h2><span>89 EUR per month</span></div>`);
    assert.strictEqual(plan.currency, '€');
    assert.strictEqual(plan.priceMonthly, 89);
  });

  it('同一页面多个档位各自取到自己的价格', () => {
    const got = plans(`
      <div><h2>Starter</h2><span>$8.99/mo</span></div>
      <div><h2>Pro</h2><span>$49/mo</span></div>
      <div><h2>Business</h2><span>$89/mo</span></div>`);
    const byName = Object.fromEntries(got.map((p) => [p.name, p.priceMonthly]));
    assert.strictEqual(byName.Starter, 8.99);
    assert.strictEqual(byName.Pro, 49);
    assert.strictEqual(byName.Business, 89);
  });
});
