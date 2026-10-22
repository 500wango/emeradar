import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyPage, calculateSerpWeakness, PAGE_CLASSIFIER_VERSION } from '../src';

/**
 * 审计问题 02（P0）：classifyPage 只看页面自身（URL/标题/摘要），「是工具页」
 * 不等于「能解决这个搜索任务」。修复：页面性质（resultType）与任务满足度
 * （queryRelevance）拆成两个独立字段；证据不足时明确 UNKNOWN，不自动当缺口。
 */
describe('查询级任务满足度（审计 02）', () => {
  it('同一个产品页，匹配与不匹配的查询得到不同的满足度', () => {
    const matched = classifyPage(
      'https://pdfmerger.example/pricing',
      'PDF Merger — merge pdf files online',
      '',
      'pdf merger'
    );
    const mismatched = classifyPage(
      'https://pdfmerger.example/pricing',
      'PDF Merger — merge pdf files online',
      '',
      'podcast editing'
    );

    assert.strictEqual(matched.kind, 'DEDICATED_TOOL');
    assert.strictEqual(mismatched.kind, 'DEDICATED_TOOL', '页面性质不随查询改变');
    assert.strictEqual(matched.queryRelevance, 'SATISFIES');
    assert.strictEqual(mismatched.queryRelevance, 'NOT_SATISFIED');
  });

  it('证据不足时明确 UNKNOWN：未知首页 + 无信息标题不判定', () => {
    const res = classifyPage('https://unknown-site.example/', 'Welcome', '', 'pdf merger');
    assert.strictEqual(res.queryRelevance, 'UNKNOWN');
  });

  it('不带查询参数的旧调用保持兼容，满足度为 UNKNOWN', () => {
    const res = classifyPage('https://pdfmerger.example/', 'PDF Merger');
    assert.strictEqual(res.queryRelevance, 'UNKNOWN');
    assert.strictEqual(res.kind, 'UNCLASSIFIED');
  });

  it('判定口径升级时版本号必须一起升', () => {
    assert.strictEqual(PAGE_CLASSIFIER_VERSION, 'page-classifier-v3');
  });

  it('SERP 弱度：确证不满足的工具页按低相关处理；UNKNOWN 不改变分数', () => {
    const item = (queryRelevance?: string) => ({
      rank: 1,
      url: 'https://tool.example/pricing',
      domain: 'tool.example',
      title: 'Tool — pricing',
      resultType: 'SPECIALIST' as const,
      ...(queryRelevance ? { queryRelevance: queryRelevance as 'SATISFIES' | 'NOT_SATISFIED' | 'UNKNOWN' } : {}),
    });

    const unknown = calculateSerpWeakness([item('UNKNOWN')]);
    const absent = calculateSerpWeakness([item()]);
    assert.strictEqual(
      unknown.items[0].totalWeakness,
      absent.items[0].totalWeakness,
      '不可靠证据（UNKNOWN）不允许改变 SERP 缺口分'
    );

    const notSatisfied = calculateSerpWeakness([item('NOT_SATISFIED')]);
    assert.strictEqual(notSatisfied.items[0].relevanceAdj, 0.2);
    assert.strictEqual(notSatisfied.items[0].weaknessType, 'LOW_RELEVANCE');
    assert.ok(notSatisfied.items[0].totalWeakness > absent.items[0].totalWeakness);
  });
});
