import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_KEYWORD_SEED_FILTER, volumeBand } from '../src';

/**
 * 入口阈值回归。
 *
 * 曾经的 `minVolume: 200 / maxDifficulty: 30` 把「我能不能赢」塞进了发现阶段：
 * 难度与搜索量正相关，KD≤30 会系统性筛掉高需求词，候选池只剩月搜几百的长尾。
 * 入口应该只按需求筛，难度交给 W 轴。
 */
describe('关键词入口阈值', () => {
  it('需求下限提高到千级，难度上限放宽到 60', () => {
    assert.ok(DEFAULT_KEYWORD_SEED_FILTER.minVolume >= 1000, '低于千级月搜的词不值得观测');
    assert.ok(DEFAULT_KEYWORD_SEED_FILTER.maxDifficulty >= 50, 'KD≤30 会系统性筛掉高需求词');
    assert.ok(DEFAULT_KEYWORD_SEED_FILTER.limit >= 50, '取回太少会让所有候选都落在长尾上');
  });

  it('需求分档用于排序与展示', () => {
    assert.strictEqual(volumeBand(1000), '1K');
    assert.strictEqual(volumeBand(4999), '1K');
    assert.strictEqual(volumeBand(5000), '5K');
    assert.strictEqual(volumeBand(20_000), '20K');
    assert.strictEqual(volumeBand(100_000), '100K+');
  });
});
