import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Free 层 feed_selected_weekly（13 §3.2、15 §3，30 Q10）。
 *
 * 资格与公开投影同源：**已失去抢跑价值**（窗口关闭 / 已被否决 / 生命周期已关闭 /
 * 连续 14 天没有活跃窗口）。仍活跃的 BUILD_NOW 任何情况下都不入选，回退也不例外。
 */
const harness = makeDisposableDb('emeradar_weekly_sel_test');

/** 仍活跃：永不入选。 */
const OPP_ACTIVE = 'opp_wk_active';
/** 今天刚关窗：本周新案例。 */
const OPP_FRESH = 'opp_wk_fresh';
/** M 轴证据不足：即使失去价值也不入选。 */
const OPP_WEAK = 'opp_wk_weak';
/** 一条已公开的历史案例：当周没有新案例时回退到它。 */
const OPP_PUBLISHED = 'opp_wk_published';

async function seed(
  id: string,
  verdict: string,
  opts: { mBand?: string; lifecycle?: string; history?: Array<[number, string]> } = {}
) {
  const { query } = harness.db;
  const slug = id.replace(/_/g, '-');
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, $2, $3, 'TRACKED', '2026-01-01')`,
    [id, slug, `${id} title`]
  );
  await query(
    `INSERT INTO opportunity_cards (
       opportunity_id, slug, primary_query, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
       confidence, recommended_archetype, execution_class, why_now_summary,
       top_idea, first_observed_at
     ) VALUES ($1, $2, $1, $3, $4,
       7000, 6000, 5000, 'HIGH', $5, 'HIGH',
       'HIGH', 'TOOL', 'S', 'fixture', 'fixture', NOW())`,
    [id, slug, verdict, opts.lifecycle ?? 'EARLY_WINDOW', opts.mBand ?? 'HIGH']
  );
  const history = opts.history ?? [[0, verdict] as [number, string]];
  for (const [daysAgo, value] of history) {
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
         prev_hash, row_hash)
       VALUES ($1, $2, CURRENT_DATE - $3::int, 'sc-1.3.0', $4, 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', $5, $6)`,
      [`vdt_${id}_${daysAgo}`, id, daysAgo, value, '0'.repeat(64), `vdt_${id}_${daysAgo}`.padEnd(64, '0').slice(0, 64)]
    );
  }
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await seed(OPP_ACTIVE, 'BUILD_NOW');
});

after(async () => {
  await harness.teardown();
});

describe('Free 精选：每周 1 条准实时案例', () => {
  it('只有活跃机会时不选任何案例（回退也不放宽资格）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const picked = await harness.services.WeeklySelectionService.getWeeklySelectedCase();
    assert.strictEqual(picked, null);
  });

  it('失去价值的机会入选，原因是 WINDOW_CLOSING，近期案例不标历史', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seed(OPP_FRESH, 'WINDOW_CLOSING', {
      history: [
        [0, 'WINDOW_CLOSING'],
        [20, 'BUILD_NOW'],
      ],
    });
    const picked = await harness.services.WeeklySelectionService.getWeeklySelectedCase();
    assert.ok(picked);
    assert.strictEqual(picked.opportunityId, OPP_FRESH);
    assert.strictEqual(picked.eligibleReason, 'WINDOW_CLOSING');
    assert.strictEqual(picked.historical, false);
  });

  it('M 轴 INSUFFICIENT 的已失去价值机会不入选', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seed(OPP_WEAK, 'WINDOW_CLOSING', { mBand: 'INSUFFICIENT' });
    const picked = await harness.services.WeeklySelectionService.getWeeklySelectedCase();
    assert.ok(picked);
    assert.notStrictEqual(picked.opportunityId, OPP_WEAK);
  });

  it('7 天内没有新案例时回退到最近一条已公开案例，并标注它的发布日期', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await seed(OPP_PUBLISHED, 'PASS', { history: [[10, 'PASS']] });
    await harness.db.query(
      `INSERT INTO public_pages (id, slug, locale, page_type, opportunity_id, status, indexable, eligibility, published_at)
       VALUES ($1, $2, 'en-US', 'OPPORTUNITY', $3, 'PUBLISHED', false, $4::jsonb, NOW() - INTERVAL '10 days')`,
      [
        `pg_${OPP_PUBLISHED}`,
        OPP_PUBLISHED.replace(/_/g, '-'),
        OPP_PUBLISHED,
        JSON.stringify({ admission: { basis: 'PASS' } }),
      ]
    );

    // 把"今天"拨到 30 天后：OPP_FRESH 也变成旧案例，本周没有新资格成立。
    const future = new Date(Date.now() + 30 * 86_400_000);
    const picked = await harness.services.WeeklySelectionService.getWeeklySelectedCase(future);
    assert.ok(picked);
    assert.strictEqual(picked.opportunityId, OPP_PUBLISHED, '当周无新案例时应回退到已公开案例');
    assert.strictEqual(picked.historical, true);
    assert.strictEqual(picked.eligibleReason, 'PASS', '理由取自发布时写下的凭据');
    const since = new Date(picked.eligibleSince).getTime();
    assert.ok(Date.now() - since > 9 * 86_400_000, '回退案例必须带上它自己的日期');
  });

  it('Free Feed 只返回精选那一条，活跃的 BUILD_NOW 不会出现在列表里', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { listFreeWeeklyFeed } = harness.services;
    const feed = await listFreeWeeklyFeed();
    assert.strictEqual(feed.items.length, 1);
    assert.strictEqual(feed.items[0].opportunityId, OPP_FRESH);
    assert.ok(!feed.items.some((item: any) => item.opportunityId === OPP_ACTIVE), '活跃 BUILD_NOW 泄露进了 Free Feed');
    assert.strictEqual(feed.total, 1);
  });

  it('Free 只能打开精选那一条的详情：按 id 或 slug 放行，活跃机会仍不放行', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { freeAccessibleOpportunityId, OpportunityService } = harness.services;
    assert.strictEqual(await freeAccessibleOpportunityId(OPP_FRESH), OPP_FRESH);
    assert.strictEqual(await freeAccessibleOpportunityId(OPP_FRESH.replace(/_/g, '-')), OPP_FRESH);
    assert.strictEqual(await freeAccessibleOpportunityId(OPP_ACTIVE), null, '活跃机会不能借详情页泄露');
    assert.strictEqual(await freeAccessibleOpportunityId('opp_does_not_exist'), null);

    // 精选卡片首次观测不满 45 天：放行路径必须不再套延迟，否则精选卡恒为 404。
    const detail = await OpportunityService.getOpportunityDetail(OPP_FRESH, { minAgeDays: 0 });
    assert.strictEqual(detail.opportunity.id, OPP_FRESH);
    await assert.rejects(
      OpportunityService.getOpportunityDetail(OPP_FRESH, { minAgeDays: 45 }),
      '旧的延迟过滤会把刚入选的精选挡掉，这正是要修的问题'
    );
  });
});
