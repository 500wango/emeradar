import { describe, it } from 'node:test';
import assert from 'node:assert';
import { dedupeKey, isCandidateKeyword } from '../src/pipeline/seed-keyword-candidates';

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
    assert.strictEqual(isCandidateKeyword(item('csv file definition'), 'csv'), false);
    assert.strictEqual(isCandidateKeyword(item('ac buy spreadsheet'), 'spreadsheet'), false);
    assert.strictEqual(isCandidateKeyword(item('purchase order template'), 'template'), true);
    assert.strictEqual(isCandidateKeyword(item('csv 文件定义'), 'csv'), false);
    assert.strictEqual(isCandidateKeyword(item('csv file', 'informational'), 'csv'), false);
  });

  it('接受真正的工具长尾', () => {
    assert.strictEqual(isCandidateKeyword(item('invoice generator'), 'generator'), true);
    assert.strictEqual(isCandidateKeyword(item('crm for agencies'), 'for agencies'), true);
    assert.strictEqual(isCandidateKeyword(item('ai valuation calculator'), 'calculator'), true);
    assert.strictEqual(isCandidateKeyword(item('csv to json converter', 'informational'), 'csv'), true);
    assert.strictEqual(
      dedupeKey('csv to excel conversion'),
      dedupeKey('convert a csv file to excel')
    );
    assert.strictEqual(dedupeKey('template spreadsheet'), dedupeKey('template for spreadsheet'));
  });

  it('具体种子必须包含种子词，宽种子必须带工具名词', () => {
    assert.strictEqual(isCandidateKeyword(item('random business name'), 'generator'), false);
    assert.strictEqual(isCandidateKeyword(item('capital gains calculator'), 'api'), false);
    assert.strictEqual(isCandidateKeyword(item('automation for freelancers'), 'for freelancers'), true);
    assert.strictEqual(isCandidateKeyword(item('market size for agencies'), 'for agencies'), false);
  });
});
