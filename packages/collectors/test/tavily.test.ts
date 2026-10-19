import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { TavilyDiscoverySource } from '../src';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('Tavily discovery 源', () => {
  it('POST /search，解析 results[] 与 published_date', async () => {
    let url = '';
    let body: any = null;
    let auth = '';
    globalThis.fetch = (async (u: any, init: any) => {
      url = String(u);
      body = JSON.parse(init.body);
      auth = init.headers.Authorization;
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          results: [{
            title: 'Pricing teardown',
            url: 'https://example.com/a',
            content: 'SaaS pricing',
            score: 0.8,
            published_date: '2026-10-01T00:00:00Z',
          }],
        }),
      } as any;
    }) as any;

    const source = new TavilyDiscoverySource(['indie saas pricing'], 'test_key');
    const outcome = await source.discover();
    assert.strictEqual(outcome.status, 'OK');
    if (outcome.status !== 'OK') return;
    assert.strictEqual(url, 'https://api.tavily.com/search');
    assert.strictEqual(auth, 'Bearer test_key');
    assert.strictEqual(body.query, 'indie saas pricing');
    assert.strictEqual(body.max_results, 10);
    assert.strictEqual(body.search_depth, 'basic');
    assert.strictEqual(outcome.items.length, 1);
    assert.strictEqual(outcome.items[0].provider, 'TAVILY');
    assert.ok(outcome.items[0].publishedAt);
  });

  it('没有 direct key 时走 AIsa Tavily 代理', async () => {
    let url = '';
    let auth = '';
    globalThis.fetch = (async (u: any, init: any) => {
      url = String(u);
      auth = init.headers.Authorization;
      return { ok: true, headers: { get: () => null }, json: async () => ({ results: [] }) } as any;
    }) as any;
    const outcome = await new TavilyDiscoverySource(['q'], '', 'aisa_key').discover();
    assert.strictEqual(outcome.status, 'OK');
    assert.strictEqual(url, 'https://api.aisa.one/apis/v1/tavily/search');
    assert.strictEqual(auth, 'Bearer aisa_key');
  });

  it('HTTP 错误或缺少 results 返回 FAILED', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 401, json: async () => ({}) } as any)) as any;
    const source = new TavilyDiscoverySource(['q'], 'test_key');
    assert.strictEqual((await source.discover()).status, 'FAILED');

    globalThis.fetch = (async () => ({ ok: true, headers: { get: () => null }, json: async () => ({ answer: 'x' }) } as any)) as any;
    const schema = await source.discover();
    assert.strictEqual(schema.status, 'FAILED');
    if (schema.status === 'FAILED') assert.match(schema.message, /results/);
  });

  it('没有 key 或没有查询时拒绝运行', async () => {
    assert.strictEqual((await new TavilyDiscoverySource(['q'], '').discover()).status, 'FAILED');
    assert.strictEqual((await new TavilyDiscoverySource([], 'test_key').discover()).status, 'FAILED');
  });
});
