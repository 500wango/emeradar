import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CostInputs, fastLaneMonthlyCost, grossMargin, slowLaneDailyCost } from '../src';

const zero: CostInputs = {
  nA: 0, nB: 0, nProjQ: 0, nAc: 0, cAc: 0, nDom: 0, cCrawl: 0, fCrawl: 1,
  rHeadless: 0, cHeadless: 0, cAttn: 0, cLlm: 0, cVolMonth: 0, cPage: 1,
};

describe('04 §6.1 cost model', () => {
  it('prices a verified project query at nine extra pages a week, not one Top-100 request', () => {
    // 7 project queries -> one query per day -> 9 extra pages/day at 1 page each.
    assert.strictEqual(slowLaneDailyCost({ ...zero, nProjQ: 7 }), 9);
  });

  it('charges A daily and B weekly', () => {
    assert.strictEqual(slowLaneDailyCost({ ...zero, nA: 3 }), 3);
    assert.strictEqual(slowLaneDailyCost({ ...zero, nB: 7 }), 1);
  });

  it('spreads crawl and headless cost over the crawl interval', () => {
    const cost = slowLaneDailyCost({ ...zero, nDom: 10, cCrawl: 2, fCrawl: 5, rHeadless: 0.5, cHeadless: 4 });
    assert.strictEqual(cost, (10 * 2) / 5 + (10 * 0.5 * 4) / 5);
  });

  it('spreads the monthly volume spend over 30 days', () => {
    assert.strictEqual(slowLaneDailyCost({ ...zero, cVolMonth: 30 }), 1);
  });

  it('fast lane scales with users and falls with the dedup hit rate', () => {
    const base = { uActive: 500, sPerUser: 2, cScan: 0.1 };
    assert.strictEqual(fastLaneMonthlyCost({ ...base, rDedup: 0 }), 100);
    assert.strictEqual(fastLaneMonthlyCost({ ...base, rDedup: 0.75 }), 25);
  });

  it('gross margin is one minus total cost over revenue', () => {
    assert.strictEqual(grossMargin(1000, 300, 100, 100), 0.5);
  });
});
