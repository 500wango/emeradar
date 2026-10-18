import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isCandidateKeyword } from '../src/pipeline/seed-keyword-candidates';

const item = (keyword: string, mainIntent = 'commercial') => ({
  keyword,
  searchVolume: 1000,
  keywordDifficulty: 10,
  mainIntent,
});

describe('种子候选过滤', () => {
  it('拒绝语义漂移的新闻/事件短语', () => {
    assert.strictEqual(isCandidateKeyword(item('2026 hell'), 'template'), false);
    assert.strictEqual(isCandidateKeyword(item('ai valuation'), 'software for'), false);
    assert.strictEqual(isCandidateKeyword(item('how to use invoice generator'), 'generator'), false);
  });

  it('接受真正的工具长尾', () => {
    assert.strictEqual(isCandidateKeyword(item('invoice generator'), 'generator'), true);
    assert.strictEqual(isCandidateKeyword(item('crm for agencies'), 'for agencies'), true);
    assert.strictEqual(isCandidateKeyword(item('ai valuation calculator'), 'calculator'), true);
  });

  it('具体种子必须包含种子词，宽种子必须带工具名词', () => {
    assert.strictEqual(isCandidateKeyword(item('random business name'), 'generator'), false);
    assert.strictEqual(isCandidateKeyword(item('automation for freelancers'), 'for freelancers'), true);
    assert.strictEqual(isCandidateKeyword(item('market size for agencies'), 'for agencies'), false);
  });
});
