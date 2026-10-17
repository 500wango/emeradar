import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ExternalDemandCollector, parseTrendsResponse, parseVolumeResponse } from '../src';

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
});
