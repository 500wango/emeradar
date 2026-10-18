import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_SEED_MARKETS, parseSeedMarkets } from '../src/pipeline/seed-keyword-candidates';

/**
 * 市场配置只做显式解析：坏行丢弃，全部无效时回退 US，不把坏配置变成“零市场”。
 */
describe('SEED_MARKETS 解析', () => {
  it('留空默认 US', () => {
    assert.deepStrictEqual(parseSeedMarkets(''), DEFAULT_SEED_MARKETS);
  });

  it('解析多个市场并规范国家代码', () => {
    const markets = parseSeedMarkets('us:2840:en-US, gb:2826:en-GB,CA:2124:fr-CA');
    assert.deepStrictEqual(markets, [
      { country: 'US', locationCode: 2840, language: 'en-US' },
      { country: 'GB', locationCode: 2826, language: 'en-GB' },
      { country: 'CA', locationCode: 2124, language: 'fr-CA' },
    ]);
  });

  it('丢弃坏行与重复国家；全部无效时回退 US', () => {
    assert.deepStrictEqual(parseSeedMarkets('GB:not-a-code,US:2840,us:9999'), [
      { country: 'US', locationCode: 2840, language: 'en-US' },
    ]);
    assert.deepStrictEqual(parseSeedMarkets('garbage'), DEFAULT_SEED_MARKETS);
  });
});
