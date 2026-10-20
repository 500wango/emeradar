import { describe, it } from 'node:test';
import assert from 'node:assert';
import { KeywordSeedCollector, parseKeywordSuggestions, DEFAULT_KEYWORD_SEED_FILTER } from '../src';

const item = (keyword: string, volume: unknown, extra: Record<string, unknown> = {}) => ({
  keyword,
  keyword_info: { search_volume: volume },
  keyword_properties: { keyword_difficulty: 12, is_another_language: false },
  search_intent_info: { main_intent: 'transactional' },
  ...extra,
});
const ok = (items: unknown[]) => ({ tasks: [{ status_code: 20000, result: [{ items }] }] });

describe('parseKeywordSuggestions', () => {
  it('keeps keywords with a numeric volume and drops the rest instead of zero-filling', () => {
    const parsed = parseKeywordSuggestions(ok([
      item('invoice generator', 4400),
      item('no volume generator', null),
      item('  ', 100),
      item('autre langue generator', 900, { keyword_properties: { keyword_difficulty: 5, is_another_language: true } }),
    ]));
    assert.deepStrictEqual(parsed, [
      { keyword: 'invoice generator', searchVolume: 4400, keywordDifficulty: 12, mainIntent: 'transactional' },
    ]);
  });

  it('treats a rejected task as failure although HTTP said 200, and no result as empty', () => {
    assert.strictEqual(parseKeywordSuggestions({ tasks: [{ status_code: 40501, result: null }] }), null);
    assert.strictEqual(parseKeywordSuggestions({}), null);
    assert.deepStrictEqual(parseKeywordSuggestions({ tasks: [{ status_code: 20000, result: [null] }] }), []);
  });
});

describe('KeywordSeedCollector', () => {
  it('sends the volume and difficulty filters through AIsa with a bearer key', async () => {
    let seenUrl = '';
    let seenAuth = '';
    let seenBody: any;
    const stub = (async (url: any, init: any) => {
      seenUrl = String(url);
      seenAuth = init.headers.Authorization;
      seenBody = JSON.parse(init.body);
      return new Response(JSON.stringify(ok([item('fantasy name generator', 2900)])), { status: 200 });
    }) as typeof fetch;
    const rows = await new KeywordSeedCollector({ aisaApiKey: 'k' }, stub).suggest('generator');
    assert.strictEqual(rows?.[0].keyword, 'fantasy name generator');
    assert.strictEqual(seenUrl, 'https://api.aisa.one/apis/v1/dataforseo/dataforseo_labs/google/keyword_suggestions/live');
    assert.strictEqual(seenAuth, 'Bearer k');
    assert.strictEqual(seenBody[0].keyword, 'generator');
    assert.strictEqual(seenBody[0].location_code, 2840);
    assert.strictEqual(seenBody[0].limit, DEFAULT_KEYWORD_SEED_FILTER.limit);
    // 入口只按需求筛。难度曾经在这里硬砍（KD≤30），而搜索量与难度正相关，
    // 结果是候选池只剩月搜几百的长尾；难度交给 W 轴判断。
    assert.deepStrictEqual(seenBody[0].filters, [
      ['keyword_info.search_volume', '>=', DEFAULT_KEYWORD_SEED_FILTER.minVolume],
      'and',
      ['keyword_info.search_volume', '<=', DEFAULT_KEYWORD_SEED_FILTER.maxVolume],
    ]);
  });

  it('ideas 走 keyword_ideas 端点并传复数 keywords', async () => {
    let seenUrl = '';
    let seenBody: any;
    const stub = (async (url: any, init: any) => {
      seenUrl = String(url);
      seenBody = JSON.parse(init.body);
      return new Response(JSON.stringify(ok([item('invoice generator', 12100)])), { status: 200 });
    }) as typeof fetch;
    const rows = await new KeywordSeedCollector({ aisaApiKey: 'k' }, stub).ideas('invoice');
    assert.strictEqual(rows?.[0].keyword, 'invoice generator');
    assert.match(seenUrl, /keyword_ideas\/live$/);
    assert.deepStrictEqual(seenBody[0].keywords, ['invoice']);
  });

  it('returns null on HTTP failure instead of throwing', async () => {
    const failing = (async () => new Response('nope', { status: 502 })) as typeof fetch;
    assert.strictEqual(await new KeywordSeedCollector({ login: 'a', password: 'b' }, failing).suggest('x'), null);
  });
});

describe('批量需求端点', () => {
  const ok = (items: any[]) => ({ tasks: [{ status_code: 20000, result: [{ items }] }] });

  it('overview 解析词量/难度/CPC', async () => {
    let seenUrl = '';
    let seenBody: any;
    const stub = (async (url: any, init: any) => {
      seenUrl = String(url);
      seenBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify(
          ok([
            {
              keyword: 'invoice generator',
              keyword_info: { search_volume: 12100, cpc: 3.2, competition: 0.8 },
              keyword_properties: { keyword_difficulty: 5 },
            },
          ])
        ),
        { status: 200 }
      );
    }) as typeof fetch;

    const rows = await new KeywordSeedCollector({ aisaApiKey: 'k' }, stub).overview(['invoice generator']);
    assert.match(seenUrl, /keyword_overview\/live$/);
    assert.deepStrictEqual(seenBody[0].keywords, ['invoice generator']);
    assert.strictEqual(rows?.[0].searchVolume, 12100);
    assert.strictEqual(rows?.[0].keywordDifficulty, 5);
    assert.strictEqual(rows?.[0].cpc, 3.2);
  });

  it('intent 解析标签与概率，入参只有 keywords', async () => {
    let seenBody: any;
    const stub = (async (_url: any, init: any) => {
      seenBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify(
          ok([
            {
              keyword: 'podcast transcript seo',
              keyword_intent: { label: 'transactional', probability: 0.7 },
              secondary_keyword_intents: [{ label: 'informational', probability: 0.3 }],
            },
          ])
        ),
        { status: 200 }
      );
    }) as typeof fetch;

    const rows = await new KeywordSeedCollector({ aisaApiKey: 'k' }, stub).intent(['podcast transcript seo']);
    assert.deepStrictEqual(Object.keys(seenBody[0]), ['keywords'], '意图端点不接受 location/language');
    assert.strictEqual(rows?.[0].label, 'transactional');
    assert.strictEqual(rows?.[0].secondary[0].label, 'informational');
  });

  it('history 解析逐月序列', async () => {
    const stub = (async () =>
      new Response(
        JSON.stringify(
          ok([
            {
              keyword: 'invoice generator',
              keyword_info: {
                search_volume: 12100,
                monthly_searches: [
                  { year: 2026, month: 1, search_volume: 9000 },
                  { year: 2026, month: 2, search_volume: 12000 },
                ],
              },
            },
          ])
        ),
        { status: 200 }
      )) as typeof fetch;

    const rows = await new KeywordSeedCollector({ aisaApiKey: 'k' }, stub).history(['invoice generator']);
    assert.strictEqual(rows?.[0].monthlySearches.length, 2);
    assert.strictEqual(rows?.[0].monthlySearches[1].searchVolume, 12000);
  });
});
