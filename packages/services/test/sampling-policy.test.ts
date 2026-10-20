import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Phase 4 分层轮询。
 *
 * 关键约束：基线期**不能**抽稀，否则任何机会都攒不够 14 天 SERP，发布门变成永动机。
 * 抽稀只发生在基线之后，并且必须留下 sampling_reason。
 */
const harness = makeDisposableDb('emeradar_sampling_policy_test');
const QRY = 'qry_sampling';

/**
 * 用**数据库的今天**，不要硬编码日期。
 *
 * 夹具以 `CURRENT_DATE - n` 造快照，而断言曾经写死 `'2026-10-19'`：
 * 到了 10-20，`obs_date < '2026-10-19'` 只剩 13 天，基线判据当场翻转，
 * 测试红了但代码是对的。日期相关的期望必须和造数据用同一个时钟。
 */
let TODAY = '';

async function seedSerpDays(count: number) {
  const { query } = harness.db;
  for (let i = 1; i <= count; i++) {
    await query(
      `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio, depth, result_count, provider)
       VALUES ($1, $2, CURRENT_DATE - $3::int, 0.5, 10, 10, 'SERPAPI')`,
      [`srp_sampling_${i}`, QRY, i]
    );
  }
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const todayRes = await harness.db.query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  TODAY = todayRes.rows[0].today;
  await harness.db.query(
    `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier)
     VALUES ($1, 'cron monitor', 'US', 'en-US', CURRENT_DATE, 'A')`,
    [QRY]
  );
});

after(async () => {
  await harness.teardown();
});

describe('Phase 4 分层轮询', () => {
  it('基线期（不足 14 天）每天抓，不抽稀', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seedSerpDays(3);
    const decision = await harness.services.decideSerpSampling(QRY, TODAY);
    assert.strictEqual(decision.collect, true);
    assert.strictEqual(decision.reason, 'BASELINE_DAILY');
  });

  it('攒够基线后、间隔内且无跳变 → 不抓（计划复用）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(`DELETE FROM serp_snapshots WHERE query_id = $1`, [QRY]);
    // 14 天基线，最后一次在 1 天前 → 不该再抓。
    await seedSerpDays(14);
    const decision = await harness.services.decideSerpSampling(QRY, TODAY);
    assert.strictEqual(decision.collect, false);
    assert.strictEqual(decision.reason, 'WEEKLY');
    assert.ok(decision.serpHistoryDays >= 14);
  });

  it('Autocomplete 顺位跳变时事件触发抓取', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    const prev = ['a', 'b', 'c', 'd', 'e'];
    await query(
      `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions, depth, provider)
       VALUES ($1, CURRENT_DATE - 1, $2, 1, 'AISA_DATAFORSEO'),
              ($1, CURRENT_DATE, $3, 1, 'AISA_DATAFORSEO')`,
      [QRY, prev, [...prev].reverse()]
    );
    const jumped = await harness.services.autocompleteJumped(QRY);
    assert.strictEqual(jumped, true);

    const decision = await harness.services.decideSerpSampling(QRY, TODAY);
    assert.strictEqual(decision.collect, true);
    assert.strictEqual(decision.reason, 'EVENT_AUTOCOMPLETE_JUMP');
  });

  it('竞品定价按域名缓存：新鲜命中不重抓，7 天内 404 直接跳过', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO commercial_targets (id, domain, target_url) VALUES ('cmt_cache', 'cache.example', 'https://cache.example/pricing')`
    );
    await query(
      `INSERT INTO commercial_snapshots (commercial_target_id, obs_date, fetch_status)
       VALUES ('cmt_cache', CURRENT_DATE - 2, 'OK')`
    );
    const hit = await harness.services.decideCommercialSampling('cache.example', TODAY);
    assert.strictEqual(hit.collect, false);
    assert.strictEqual(hit.reason, 'DOMAIN_CACHE_HIT');

    await query(
      `INSERT INTO commercial_targets (id, domain, target_url) VALUES ('cmt_dead', 'dead.example', 'https://dead.example/pricing')`
    );
    await query(
      `INSERT INTO commercial_snapshots (commercial_target_id, obs_date, fetch_status)
       VALUES ('cmt_dead', CURRENT_DATE - 2, 'BLOCKED_404')`
    );
    const dead = await harness.services.decideCommercialSampling('dead.example', TODAY);
    assert.strictEqual(dead.collect, false);
    assert.strictEqual(dead.reason, 'CONFIRMED_404');
  });
});
