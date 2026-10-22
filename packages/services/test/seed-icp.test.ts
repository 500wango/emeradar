import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';
import {
  DEFAULT_ICP_EXCLUSIONS,
  icpAllowsCarrier,
  icpTagsForCarrier,
  parseSeedIcpExclusions,
} from '../src/pipeline/seed-keyword-candidates';

const harness = makeDisposableDb('emeradar_seed_icp_test');
before(async () => {
  await harness.setup();
});
after(async () => {
  await harness.teardown();
});

const s = (keyword: string) => ({
  keyword,
  searchVolume: 1000,
  keywordDifficulty: 10,
  mainIntent: 'transactional',
});

describe('ICP 过滤（审计 07）', () => {
  it('默认排除 GPU 媒体与强合规载体', () => {
    assert.ok(DEFAULT_ICP_EXCLUSIONS.includes('gpu_media'));
    assert.ok(DEFAULT_ICP_EXCLUSIONS.includes('regulated'));
  });

  it('video / payroll 被排除，csv / json 通过（审计回归样本）', () => {
    assert.strictEqual(icpAllowsCarrier('video'), false, 'video generation 需 GPU，不适合零 GPU 独立开发者');
    assert.strictEqual(icpAllowsCarrier('payroll'), false, 'payroll compliance 需行业知识');
    assert.strictEqual(icpAllowsCarrier('csv'), true, 'CSV validator 是适配样本');
    assert.strictEqual(icpAllowsCarrier('json'), true, 'JSON diff 是适配样本');
  });

  it('每个载体都有可解释的标签（允许空）', () => {
    assert.deepStrictEqual(icpTagsForCarrier('video'), ['gpu_media']);
    assert.deepStrictEqual(icpTagsForCarrier('payroll'), ['regulated']);
    assert.deepStrictEqual(icpTagsForCarrier('invoice'), []);
  });

  it('SEED_ICP_EXCLUDE 可覆盖默认；空串关闭过滤', () => {
    assert.deepStrictEqual(parseSeedIcpExclusions('gpu_media'), ['gpu_media']);
    assert.strictEqual(parseSeedIcpExclusions('').length, 0);
    assert.strictEqual(
      icpAllowsCarrier('video', parseSeedIcpExclusions('')),
      true,
      '显式清空排除表 = 不过滤'
    );
  });

  it('seedKeywordCandidates 不为被排除载体建候选', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const fake = {
      suggest: async () => [s('video generation tool'), s('video editing software')],
      ideas: async () => null,
    } as any;
    const result = await harness.services.seedKeywordCandidates('2026-10-23', fake, {
      seeds: [{ seed: 'video', archetype: 'TOOL' as const }],
    });
    assert.strictEqual(result.created, 0);
    assert.deepStrictEqual(result.excludedSeeds, ['video']);
  });

  it('seedKeywordCandidates 为适配载体正常建候选，并在 candidate_reason 留 ICP 标记', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const fake = {
      suggest: async () => [s('csv validator tool')],
      ideas: async () => null,
    } as any;
    const result = await harness.services.seedKeywordCandidates('2026-10-23', fake, {
      seeds: [{ seed: 'csv', archetype: 'TOOL' as const }],
    });
    assert.strictEqual(result.created, 1);
    assert.deepStrictEqual(result.excludedSeeds, []);
    const reason = await harness.db.query<{ candidate_reason: string }>(
      `SELECT candidate_reason FROM opportunities WHERE discovery_source = 'KEYWORD_SEED'
         AND id IN (SELECT opportunity_id FROM opportunity_queries oq JOIN queries q ON q.id = oq.query_id
                     WHERE q.query_text = 'csv validator tool')`
    );
    assert.match(reason.rows[0].candidate_reason, /ICP fit/i);
  });
});
