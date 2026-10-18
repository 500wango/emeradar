import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { AIsaSearchDiscoverySource } from '../src';

/**
 * AIsa 多源搜索（discovery）。
 *
 * 这里钉住三件事：必须带 `q`（旧实现空 body 422）、解析 `webPages.value[]`、
 * 以及成本按请求数记账。它只做 discovery，不是 SERP。
 */
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('AIsa 多源搜索 discovery 源', () => {
  it('带 q 请求并解析 webPages.value[]', async () => {
    let requested: string | undefined;
    globalThis.fetch = (async (url: any) => {
      requested = String(url);
      return {
        ok: true,
        json: async () => ({
          webPages: {
            value: [
              {
                name: 'Indie tool pricing teardown',
                url: 'https://example.com/posts/pricing',
                snippet: 'A teardown of indie tool pricing.',
                datePublished: '2026-10-01T00:00:00Z',
                score: 0.92,
              },
            ],
          },
        }),
      } as any;
    }) as any;

    const source = new AIsaSearchDiscoverySource(['indie tool pricing'], 'test_key');
    const outcome = await source.discover();
    assert.strictEqual(outcome.status, 'OK');
    if (outcome.status !== 'OK') return;

    assert.ok(requested?.includes('q=indie+tool+pricing'), `请求没有带 q：${requested}`);
    assert.strictEqual(outcome.items.length, 1);
    assert.strictEqual(outcome.items[0].provider, 'AISA_SEARCH');
    assert.strictEqual(outcome.items[0].sourceUrl, 'https://example.com/posts/pricing');
    assert.strictEqual(outcome.cost.category, 'INFRA');
    assert.strictEqual(outcome.cost.units, 1);
    assert.strictEqual(outcome.cost.costUsd, 0.001);
  });

  it('HTTP 422（缺 q 等）返回 FAILED，而不是空结果', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 422, json: async () => ({}) } as any)) as any;
    const source = new AIsaSearchDiscoverySource(['anything'], 'test_key');
    const outcome = await source.discover();
    assert.strictEqual(outcome.status, 'FAILED');
    if (outcome.status === 'FAILED') assert.match(outcome.message, /422/);
  });

  it('响应没有 webPages.value 时判 schema 失败', async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ results: [] }) } as any)) as any;
    const source = new AIsaSearchDiscoverySource(['anything'], 'test_key');
    const outcome = await source.discover();
    assert.strictEqual(outcome.status, 'FAILED');
    if (outcome.status === 'FAILED') assert.match(outcome.message, /webPages/);
  });

  it('没有 key 或没有种子查询时拒绝运行', async () => {
    const noKey = new AIsaSearchDiscoverySource(['anything'], '');
    assert.strictEqual((await noKey.discover()).status, 'FAILED');
    const noQueries = new AIsaSearchDiscoverySource([], 'test_key');
    assert.strictEqual((await noQueries.discover()).status, 'FAILED');
  });
});
