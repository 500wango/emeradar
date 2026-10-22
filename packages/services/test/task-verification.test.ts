import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';
import { assessTaskVerification, TASK_VERIFICATION_VERSION } from '../src/task-verification';

const harness = makeDisposableDb('emeradar_task_gate_test');
before(async () => {
  await harness.setup();
});
after(async () => {
  await harness.teardown();
});

describe('任务价值准入 Gate（审计 01）', () => {
  describe('assessTaskVerification（确定性判据）', () => {
    it('新闻/事件型条目判 REFUTED：SERP 非空也不能晋级为任务', () => {
      const res = assessTaskVerification({
        sourceTitle: 'Hell Tour 2026: dates, cities and tickets announced',
        queryHypothesis: 'hell tour 2026 schedule tool',
        serpItems: [
          { resultType: 'EDITORIAL_MEDIA', title: 'Hell Tour 2026 dates announced', queryRelevance: 'UNKNOWN' },
        ],
        autocompleteSuggestions: ['hell tour 2026 tickets'],
      });
      assert.strictEqual(res.taskStatus, 'TASK_REFUTED');
      assert.strictEqual(TASK_VERIFICATION_VERSION.startsWith('task-verification-'), true);
    });

    it('裸品牌/导航词判 REFUTED', () => {
      const res = assessTaskVerification({
        sourceTitle: 'Notion raises at $10B valuation',
        queryHypothesis: 'notion',
      });
      assert.strictEqual(res.taskStatus, 'TASK_REFUTED');
    });

    it('检索证据 + 独立需求信号（UGC 讨论、任务型联想词）判 VERIFIED', () => {
      const res = assessTaskVerification({
        sourceTitle: 'Show HN: I built an invoice generator for freelancers',
        queryHypothesis: 'invoice generator tool',
        serpItems: [
          {
            resultType: 'UGC_THREAD',
            title: 'Best invoice generator for freelancers?',
            queryRelevance: 'SATISFIES',
          },
          { resultType: 'SPECIALIST', title: 'Invoice generator — pricing', queryRelevance: 'SATISFIES' },
        ],
        autocompleteSuggestions: ['invoice generator free', 'invoice generator pdf'],
      });
      assert.strictEqual(res.taskStatus, 'TASK_VERIFIED');
      assert.ok(res.signals.length >= 1, '信号必须留痕以便审计');
    });

    it('只有检索证据、没有独立需求信号时停留在 UNVERIFIED', () => {
      const res = assessTaskVerification({
        sourceTitle: 'A new file format appeared',
        queryHypothesis: 'xyz format converter tool',
        serpItems: [{ resultType: 'EDITORIAL_MEDIA', title: 'A new file format appeared', queryRelevance: 'UNKNOWN' }],
        autocompleteSuggestions: [],
      });
      assert.strictEqual(res.taskStatus, 'TASK_UNVERIFIED');
    });
  });

  describe('管线集成', () => {
    it('validateDiscoveryIntents：新闻条目判 REFUTED 并把 intent 置 REJECTED', async (t) => {
      if (!harness.available) return t.skip(harness.skipReason);
      const { query } = harness.db;
      await query(
        `INSERT INTO sources (id, type, name) VALUES ('src_news_test', 'RSS', 'test')
         ON CONFLICT (id) DO NOTHING`
      );
      await query(
        `INSERT INTO discovery_items (id, source_id, source_item_id, provider, source_url, title, content_hash, request_hash)
         VALUES ('di_news', 'src_news_test', 'item-news', 'TEST', 'https://news.example/hell-tour',
                 'Hell Tour 2026: dates, cities and tickets announced', 'hash-news', 'req-news')
         ON CONFLICT (id) DO NOTHING`
      );
      await query(
        `INSERT INTO discovery_intents (id, discovery_item_id, intent_kind, query_hypothesis, status)
         VALUES ('dint_news', 'di_news', 'USE', 'hell tour 2026 schedule tool', 'HYPOTHESIS')
         ON CONFLICT (id) DO NOTHING`
      );

      const fakeSerp = {
        collect: async () => ({
          status: 'OK',
          snapshots: [
            {
              data: {
                items: [
                  {
                    rank: 1,
                    url: 'https://news.example/hell-tour',
                    domain: 'news.example',
                    title: 'Hell Tour 2026 dates announced',
                    resultType: 'EDITORIAL_MEDIA',
                    queryRelevance: 'UNKNOWN',
                  },
                ],
                weakResultRatio: 0,
                weaknessScore: 10,
              },
            },
          ],
        }),
      };
      const fakeAc = {
        collect: async () => ({
          status: 'OK',
          snapshots: [{ data: { suggestions: ['hell tour 2026 tickets'] } }],
        }),
      };

      const n = await harness.services.validateDiscoveryIntents(5, '2026-10-23', {
        ac: fakeAc,
        serp: fakeSerp,
      });
      assert.strictEqual(n, 1);

      const intent = await query<{ status: string }>(
        `SELECT status FROM discovery_intents WHERE id = 'dint_news'`
      );
      assert.strictEqual(intent.rows[0].status, 'REJECTED', '检索证据存在 ≠ 用户任务存在');

      const validation = await query<{ task_status: string }>(
        `SELECT task_status FROM discovery_validations WHERE discovery_intent_id = 'dint_news'`
      );
      assert.strictEqual(validation.rows[0].task_status, 'TASK_REFUTED');
    });

    it('generateExperimentCards 只为 TASK_VERIFIED 的 intent 建卡', async (t) => {
      if (!harness.available) return t.skip(harness.skipReason);
      const { query } = harness.db;
      await query(
        `INSERT INTO discovery_items (id, source_id, source_item_id, provider, source_url, title, content_hash, request_hash)
         VALUES ('di_invoice', 'src_news_test', 'item-invoice', 'TEST', 'https://news.example/invoice-hn',
                 'Show HN: I built an invoice generator for freelancers', 'hash-invoice', 'req-invoice')
         ON CONFLICT (id) DO NOTHING`
      );
      await query(
        `INSERT INTO discovery_intents (id, discovery_item_id, intent_kind, query_hypothesis, status)
         VALUES ('dint_invoice', 'di_invoice', 'USE', 'invoice generator tool', 'HYPOTHESIS')
         ON CONFLICT (id) DO NOTHING`
      );

      const fakeSerp = {
        collect: async () => ({
          status: 'OK',
          snapshots: [
            {
              data: {
                items: [
                  {
                    rank: 1,
                    url: 'https://www.reddit.com/r/freelance/x',
                    domain: 'reddit.com',
                    title: 'Best invoice generator for freelancers?',
                    resultType: 'UGC_THREAD',
                    queryRelevance: 'SATISFIES',
                  },
                ],
                weakResultRatio: 0.6,
                weaknessScore: 60,
              },
            },
          ],
        }),
      };
      const fakeAc = {
        collect: async () => ({
          status: 'OK',
          snapshots: [
            { data: { suggestions: ['invoice generator free', 'invoice generator pdf'] } },
          ],
        }),
      };

      await harness.services.validateDiscoveryIntents(5, '2026-10-23', {
        ac: fakeAc,
        serp: fakeSerp,
      });
      const intent = await query<{ status: string }>(
        `SELECT status FROM discovery_intents WHERE id = 'dint_invoice'`
      );
      assert.strictEqual(intent.rows[0].status, 'OBSERVED');

      await harness.services.generateExperimentCards(20);
      const cards = await query<{ id: string }>(
        `SELECT id FROM experiment_cards WHERE discovery_intent_id = 'dint_invoice'`
      );
      assert.strictEqual(cards.rows.length, 1, '有任务证据的条目进入实验推荐');

      // REFUTED 的条目绝不建卡
      const refuted = await query<{ id: string }>(
        `SELECT id FROM experiment_cards WHERE discovery_intent_id = 'dint_news'`
      );
      assert.strictEqual(refuted.rows.length, 0);
    });
  });
});
