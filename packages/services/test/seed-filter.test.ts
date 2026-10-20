import { describe, it } from 'node:test';
import assert from 'node:assert';
import { dedupeKey, isCandidateKeyword, mergeByKeyword } from '../src/pipeline/seed-keyword-candidates';

const item = (keyword: string, mainIntent = 'commercial') => ({
  keyword,
  searchVolume: 1000,
  keywordDifficulty: 10,
  mainIntent,
});

describe('两路数据合并', () => {
  it('同词取较大搜索量，并按量降序', () => {
    const merged = mergeByKeyword(
      [{ keyword: 'invoice generator', searchVolume: 1200, keywordDifficulty: 5, mainIntent: 'transactional' }],
      [
        { keyword: 'invoice generator', searchVolume: 12000, keywordDifficulty: 5, mainIntent: 'transactional' },
        { keyword: 'invoice template', searchVolume: 4000, keywordDifficulty: 10, mainIntent: 'commercial' },
      ]
    );
    assert.strictEqual(merged?.length, 2);
    assert.strictEqual(merged?.[0].keyword, 'invoice generator');
    assert.strictEqual(merged?.[0].searchVolume, 12000);
  });

  it('一路失败时用另一路，不把失败当空集', () => {
    assert.strictEqual(mergeByKeyword(null, null), null);
    const merged = mergeByKeyword(null, [
      { keyword: 'a b', searchVolume: 1500, keywordDifficulty: 5, mainIntent: null },
    ]);
    assert.strictEqual(merged?.length, 1);
  });
});

describe('种子候选过滤（载体 × 工具动词）', () => {
  it('载体 + 工具动词才通过', () => {
    assert.strictEqual(isCandidateKeyword(item('invoice generator'), 'invoice'), true);
    assert.strictEqual(isCandidateKeyword(item('invoice template'), 'invoice'), true);
    assert.strictEqual(isCandidateKeyword(item('pdf converter'), 'pdf'), true);
  });

  it('拒绝物理产品与不含载体的词', () => {
    // 这是旧实现最大的漏洞：种子是 "generator"，于是 electric generator 也算“工具”。
    assert.strictEqual(isCandidateKeyword(item('electric generator'), 'generator'), false);
    assert.strictEqual(isCandidateKeyword(item('diesel generator for sale'), 'generator'), false);
    assert.strictEqual(isCandidateKeyword(item('pokemon generator'), 'invoice'), false);
  });

  it('只有载体没有动作（内容型）不通过', () => {
    assert.strictEqual(isCandidateKeyword(item('invoice'), 'invoice'), false);
    assert.strictEqual(isCandidateKeyword(item('invoice format'), 'invoice'), false);
  });

  it('拒绝定义、信息型前缀、价格询问与中文', () => {
    assert.strictEqual(isCandidateKeyword(item('invoice definition'), 'invoice'), false);
    assert.strictEqual(isCandidateKeyword(item('how to make invoice generator'), 'invoice'), false);
    assert.strictEqual(isCandidateKeyword(item('invoice cost'), 'invoice'), false);
    assert.strictEqual(isCandidateKeyword(item('发票 生成器'), 'invoice'), false);
  });

  it('导航词直接出局', () => {
    assert.strictEqual(isCandidateKeyword(item('invoice generator', 'navigational'), 'invoice'), false);
  });
});

describe('同义变体合并（截图里的三个 lunch 变体）', () => {
  it('with 之类的连接词不影响指纹', () => {
    assert.strictEqual(
      dedupeKey('timesheet calculator lunch'),
      dedupeKey('timesheet calculator with lunch')
    );
  });

  it('多一个实词（break）就是不同的词，不强行合并', () => {
    assert.notStrictEqual(
      dedupeKey('timesheet calculator lunch'),
      dedupeKey('timesheet with lunch break calculator')
    );
  });

  it('带 & 的组合词被拒绝（关键词工具拼出来的，不是真实搜索词）', () => {
    assert.strictEqual(
      isCandidateKeyword(item('time tracker & employee timesheet software'), 'timesheet'),
      false
    );
  });
});
