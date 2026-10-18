import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ExternalDemandCollector, credentialsFromEnv, parseTrendsResponse, parseVolumeResponse } from '../src';

const ok = (result: unknown) => ({ tasks: [{ status_code: 20000, result }] });

describe('external demand parsers', () => {
  it('parses monthly volume and drops malformed months', () => {
    const parsed = parseVolumeResponse(
      ok([{ keyword: 'invoice generator', monthly_searches: [
        { year: 2026, month: 1, search_volume: 500 },
        { year: 2026, month: 13, search_volume: 9 },
        { year: 2026, month: 2, search_volume: -1 },
        { year: 2026, month: 3 },
      ] }])
    );
    assert.deepStrictEqual(parsed?.get('invoice generator'), [{ date: '2026-01-01', value: 500 }]);
  });

  it('returns null, not an empty map, when the task failed or the shape is wrong', () => {
    assert.strictEqual(parseVolumeResponse({ tasks: [{ status_code: 40501, result: null }] }), null);
    assert.strictEqual(parseVolumeResponse({}), null);
    assert.strictEqual(parseVolumeResponse(ok([{ nokeyword: true }])), null);
  });

  it('parses the trends graph and ignores non-numeric points', () => {
    const parsed = parseTrendsResponse(
      ok([{ items: [{ type: 'google_trends_graph', data: [
        { date_from: '2026-01-04', values: [40] },
        { date_from: '2026-01-11', values: [null] },
        { date_from: '2026-01-18', values: [60] },
      ] }] }])
    );
    assert.deepStrictEqual(parsed, [{ date: '2026-01-04', value: 40 }, { date: '2026-01-18', value: 60 }]);
    assert.strictEqual(parseTrendsResponse(ok([{ items: [] }])), null);
  });
});

describe('ExternalDemandCollector', () => {
  it('sends basic auth and returns null on HTTP failure instead of throwing', async () => {
    let seenAuth = '';
    const failing = (async (_url: any, init: any) => {
      seenAuth = init.headers.Authorization;
      return new Response('nope', { status: 500 });
    }) as typeof fetch;
    const collector = new ExternalDemandCollector({ login: 'a', password: 'b' }, failing);
    assert.strictEqual(await collector.fetchVolume(['x']), null);
    assert.strictEqual(seenAuth, `Basic ${Buffer.from('a:b').toString('base64')}`);
  });

  it('routes through AIsa with a bearer key, same DataForSEO path and envelope', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const viaAisa = (async (url: any, init: any) => {
      seenUrl = String(url);
      seenAuth = init.headers.Authorization;
      return new Response(JSON.stringify(ok([{ keyword: 'x', monthly_searches: [{ year: 2026, month: 9, search_volume: 70 }] }])), { status: 200 });
    }) as typeof fetch;
    const collector = new ExternalDemandCollector({ aisaApiKey: 'k' }, viaAisa);
    assert.deepStrictEqual((await collector.fetchVolume(['x']))?.get('x'), [{ date: '2026-09-01', value: 70 }]);
    assert.strictEqual(seenUrl, 'https://api.aisa.one/apis/v1/dataforseo/keywords_data/google_ads/search_volume/live');
    assert.strictEqual(seenAuth, 'Bearer k');
  });
});

describe('credentialsFromEnv', () => {
  it('prefers direct DataForSEO credentials, falls back to AIsa, else null', () => {
    assert.deepStrictEqual(
      credentialsFromEnv({ DATAFORSEO_LOGIN: 'a', DATAFORSEO_PASSWORD: 'b', AISA_API_KEY: 'k' } as any),
      { login: 'a', password: 'b' }
    );
    assert.deepStrictEqual(credentialsFromEnv({ AISA_API_KEY: 'k' } as any), { aisaApiKey: 'k' });
    assert.strictEqual(credentialsFromEnv({} as any), null);
  });
});
