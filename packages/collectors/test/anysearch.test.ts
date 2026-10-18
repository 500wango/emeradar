import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { AnySearchDiscoverySource } from '../src';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; delete process.env.ANYSEARCH_ALLOW_ANONYMOUS; });

describe('AnySearch discovery 源', () => {
  it('POST /v1/search，解析 data.results[]', async () => {
    let url = '';
    let body: any = null;
    let auth = '';
    globalThis.fetch = (async (u: any, init: any) => {
      url = String(u);
      body = JSON.parse(init.body);
      auth = init.headers.Authorization;
      return {
        ok: true,
        json: async () => ({
          code: 0,
          message: 'success',
          data: { results: [{ title: 'Pricing teardown', url: 'https://example.com/a', snippet: 'SaaS pricing' }] },
        }),
      } as any;
    }) as any;

    const source = new AnySearchDiscoverySource(['indie saas pricing'], 'test_key');
    const outcome = await source.discover();
    assert.strictEqual(outcome.status, 'OK');
    if (outcome.status !== 'OK') return;
    assert.strictEqual(url, 'https://api.anysearch.com/v1/search');
    assert.strictEqual(auth, 'Bearer test_key');
    assert.strictEqual(body.query, 'indie saas pricing');
    assert.strictEqual(body.max_results, 10);
    assert.strictEqual(outcome.items.length, 1);
    assert.strictEqual(outcome.items[0].provider, 'ANYSEARCH');
    assert.strictEqual(outcome.items[0].sourceUrl, 'https://example.com/a');
  });

  it('HTTP 错误或业务 code != 0 返回 FAILED', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 401, json: async () => ({}) } as any)) as any;
    const source = new AnySearchDiscoverySource(['q'], 'test_key');
    const failed = await source.discover();
    assert.strictEqual(failed.status, 'FAILED');

    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ code: 4001, message: 'quota' }) } as any)) as any;
    const business = await source.discover();
    assert.strictEqual(business.status, 'FAILED');
    if (business.status === 'FAILED') assert.match(business.message, /4001/);
  });

  it('没有 key 且未显式允许匿名时拒绝运行', async () => {
    const source = new AnySearchDiscoverySource(['q'], '');
    const outcome = await source.discover();
    assert.strictEqual(outcome.status, 'FAILED');
    if (outcome.status === 'FAILED') assert.strictEqual(outcome.errorCode, 'ANYSEARCH_NOT_CONFIGURED');
  });

  it('响应没有 data.results 时判 schema 失败', async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ code: 0, data: {} }) } as any)) as any;
    const source = new AnySearchDiscoverySource(['q'], 'test_key');
    const outcome = await source.discover();
    assert.strictEqual(outcome.status, 'FAILED');
    if (outcome.status === 'FAILED') assert.match(outcome.message, /data\.results/);
  });
});
