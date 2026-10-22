import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 审计问题 03（P0）：Feed 默认 `ORDER BY d_basis_points DESC` 且无 verdict 限定，
 * 高 D 的 WATCH/PASS 会混进首屏。修复：默认 track='BUILDABLE'（只含
 * BUILD_NOW / EARLY_BET 且置信度非 LOW），排序按裁决质量 → 置信度 → D；
 * WATCH/PASS 走观察/排除分栏，显式 verdict 过滤的老调用方行为不变。
 */
const harness = makeDisposableDb('emeradar_feed_tracks_test');
before(async () => {
  await harness.setup();
});
after(async () => {
  await harness.teardown();
});

async function seedCard(
  id: string,
  slug: string,
  verdict: string,
  confidence: string,
  d: number
) {
  const { query } = harness.db;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, market_country, research_language,
       first_observed_date, recommended_archetype, execution_class, discovery_source, discovered_at)
     VALUES ($1, $2, $3, 'TRACKED', 'US', 'en-US', '2026-08-01', 'TOOL', 'S', 'KEYWORD_SEED', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, slug, `Opportunity ${id}`]
  );
  await query(
    `INSERT INTO opportunity_cards (opportunity_id, slug, primary_query, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band, confidence,
       recommended_archetype, execution_class, why_now_summary, top_idea, first_observed_at)
     VALUES ($1, $2, $3, $4, 'EARLY_WINDOW', $5, 6200, 5000, 'HIGH', 'MEDIUM', 'MEDIUM', $6,
       'TOOL', 'S', 'test', 'test', NOW())
     ON CONFLICT (opportunity_id) DO UPDATE SET
       verdict = EXCLUDED.verdict, d_basis_points = EXCLUDED.d_basis_points,
       confidence = EXCLUDED.confidence`,
    [id, slug, `${slug} tool`, verdict, d, confidence]
  );
}

describe('Feed 分栏与排序（审计 03）', () => {
  it('默认只出可构建机会：WATCH/PASS 不进首屏，排序先裁决质量再 D 分', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seedCard('opp_feed_a', 'feed-early-bet', 'EARLY_BET', 'HIGH', 9500);
    await seedCard('opp_feed_b', 'feed-build-now', 'BUILD_NOW', 'HIGH', 9000);
    await seedCard('opp_feed_c', 'feed-watch-high-d', 'WATCH', 'HIGH', 9800);
    await seedCard('opp_feed_d', 'feed-pass-high-d', 'PASS', 'MEDIUM', 9700);
    await seedCard('opp_feed_e', 'feed-build-low-conf', 'BUILD_NOW', 'LOW', 9600);

    const { OpportunityService } = harness.services;
    const page = await OpportunityService.listFeedCards({});
    const verdicts = page.items.map((i: { verdict: string }) => i.verdict);
    assert.ok(verdicts.includes('BUILD_NOW'));
    assert.ok(verdicts.includes('EARLY_BET'));
    assert.ok(!verdicts.includes('WATCH'), 'WATCH 不进可构建分栏');
    assert.ok(!verdicts.includes('PASS'), 'PASS 不进可构建分栏');
    assert.ok(!page.items.some((i: { confidence: string }) => i.confidence === 'LOW'),
      '低置信度不进可构建分栏');

    // 裁决质量优先于 D 分：BUILD_NOW(9000) 排在 EARLY_BET(9500) 前面
    assert.strictEqual(page.items[0].verdict, 'BUILD_NOW');
    assert.strictEqual(page.items[1].verdict, 'EARLY_BET');
    assert.strictEqual(page.items[0].dBasisPoints, 9000);
    assert.strictEqual(page.items[1].dBasisPoints, 9500);
  });

  it('WATCHLIST / EXCLUDED / ALL 分栏各自可达', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { OpportunityService } = harness.services;

    const watch = await OpportunityService.listFeedCards({ track: 'WATCHLIST' });
    assert.ok(watch.items.length > 0);
    assert.ok(watch.items.every((i: { verdict: string }) => i.verdict === 'WATCH'));

    const excluded = await OpportunityService.listFeedCards({ track: 'EXCLUDED' });
    assert.ok(excluded.items.length > 0);
    assert.ok(
      excluded.items.every((i: { verdict: string }) => ['PASS', 'WINDOW_CLOSING'].includes(i.verdict))
    );

    const all = await OpportunityService.listFeedCards({ track: 'ALL' });
    const verdicts = new Set(all.items.map((i: { verdict: string }) => i.verdict));
    assert.ok(verdicts.has('WATCH') && verdicts.has('PASS') && verdicts.has('BUILD_NOW'));
  });

  it('显式 verdict 过滤（老调用方）不受默认分栏影响', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { OpportunityService } = harness.services;
    const watch = await OpportunityService.listFeedCards({ verdicts: ['WATCH'] });
    assert.ok(watch.items.length > 0);
    assert.ok(watch.items.every((i: { verdict: string }) => i.verdict === 'WATCH'));
  });
});
