import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * `docs/15 §3` 的公开准入判据（v3.1：**已失去抢跑价值**）。
 *
 * 这些用例只能用夹具验，原因值得写下来：**dev 库里这条判据几乎选不出任何一条机会**
 * （`public_pages` 是 0 行，机会全部 ≤14 天且仍活跃）。所以"本地跑起来什么都没变"是
 * 预期的，不能据此推断实现没生效。
 *
 * **每个用例用自己的机会 id。** `verdicts` 挂着只追加触发器，夹具写进去的行永远删不掉
 * ——共用一条机会会在第二个用例上撞主键，而失败原因与被测行为无关。牵涉「已收录集合」
 * 的用例开头都会清一次 `public_pages`，否则结论取决于执行顺序。
 *
 * 用例按 18 §4.1「公开资格」四行组织：活跃阻断、失去价值即公开、14 天边界、
 * 非单调撤回。
 */

const harness = makeDisposableDb('emeradar_publication_eligibility_test');

const KEYWORD = 'quixotic-zebra-undertaking';

interface SeedOptions {
  id: string;
  verdict: string;
  lifecycle?: string;
  mBand?: string;
  wBand?: string;
  firstObservedDaysAgo?: number;
}

/** 一条机会 + 卡片。`verdict` 同时写进卡片；账本序列由 `seedVerdicts` 单独给。 */
async function seedOpportunity(opts: SeedOptions): Promise<void> {
  const { query } = harness.db;
  const slug = opts.id.replace(/_/g, '-');
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, $2, $3, 'TRACKED', CURRENT_DATE - $4::int)`,
    [opts.id, slug, `${KEYWORD} title`, opts.firstObservedDaysAgo ?? 3]
  );
  await query(
    `INSERT INTO opportunity_cards (
       opportunity_id, slug, primary_query, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
       confidence, recommended_archetype, execution_class, why_now_summary,
       top_idea, first_observed_at
     ) VALUES ($1, $2, $3, $4, $5,
       7000, 6000, 5000, 'HIGH', $6, $7,
       'HIGH', 'TOOL', 'WEEKEND', $3, $3, NOW())`,
    [
      opts.id,
      slug,
      KEYWORD,
      opts.verdict,
      opts.lifecycle ?? 'EARLY_WINDOW',
      opts.mBand ?? 'MEDIUM',
      opts.wBand ?? 'MEDIUM',
    ]
  );
}

/** 账本：`[[daysAgo, verdict], ...]`，0 表示今天。 */
async function seedVerdicts(
  opportunityId: string,
  rows: Array<[number, string] | [number, string, string[]]>
): Promise<void> {
  const { query } = harness.db;
  for (const [daysAgo, verdict, flags] of rows) {
    const id = `vdt_${opportunityId}_${daysAgo}`;
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence, prev_hash, row_hash, flags)
       VALUES ($1, $2, CURRENT_DATE - $3::int, 'sc-1.3.0', $4, 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', $5, $6, $7)`,
      [id, opportunityId, daysAgo, verdict, '0'.repeat(64), id.padEnd(64, '0').slice(0, 64), flags ?? []]
    );
  }
}

/**
 * 「已失去抢跑价值」的一条机会。四种 basis 各给一个入口：
 *   · closing   —— 最新裁决 WINDOW_CLOSING（30 天前活跃过一次）；
 *   · pass      —— 最新裁决 PASS；
 *   · lifecycle —— 最新裁决 WATCH、生命周期 CONTESTED、昨天还活跃（只靠第 2 条成立）；
 *   · inactive  —— 最新裁决 WATCH、生命周期 EARLY_WINDOW、最后活跃在 14 天前。
 */
async function seedLost(
  id: string,
  basis: 'closing' | 'pass' | 'lifecycle' | 'inactive',
  opts: { mBand?: string; wBand?: string } = {}
): Promise<void> {
  if (basis === 'closing') {
    await seedOpportunity({ id, verdict: 'WINDOW_CLOSING', ...opts });
    await seedVerdicts(id, [
      [0, 'WINDOW_CLOSING'],
      [30, 'BUILD_NOW'],
    ]);
  } else if (basis === 'pass') {
    await seedOpportunity({ id, verdict: 'PASS', ...opts });
    await seedVerdicts(id, [
      [0, 'PASS'],
      [2, 'WATCH'],
      [5, 'BUILD_NOW'],
    ]);
  } else if (basis === 'lifecycle') {
    await seedOpportunity({ id, verdict: 'WATCH', lifecycle: 'CONTESTED', ...opts });
    await seedVerdicts(id, [
      [0, 'WATCH'],
      [1, 'BUILD_NOW'],
    ]);
  } else {
    await seedOpportunity({ id, verdict: 'WATCH', ...opts });
    await seedVerdicts(id, [
      [0, 'WATCH'],
      [14, 'BUILD_NOW'],
    ]);
  }
}

/** 给机会挂一条 PRIMARY query，并写一份最新 SERP 快照。 */
async function seedPrimaryWithSerp(opportunityId: string, urls: string[]): Promise<void> {
  const { query } = harness.db;
  const queryId = `qry_${opportunityId}`;
  // `queries` 有 `UNIQUE (query_text, market_country, research_language)`，所以 query_text
  // 必须逐机会不同——用同一个词根会让第二个用例撞唯一约束。
  await query(`INSERT INTO queries (id, query_text) VALUES ($1, $2)`, [queryId, `${KEYWORD} ${opportunityId}`]);
  await query(`INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ($1, $2, 'PRIMARY')`, [
    opportunityId,
    queryId,
  ]);
  await query(
    `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio) VALUES ($1, $2, CURRENT_DATE, 0)`,
    [`srp_${queryId}`, queryId]
  );
  for (const [index, url] of urls.entries()) {
    await query(
      `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title) VALUES ($1, $2, $3, $4, $5)`,
      [`srp_${queryId}`, index + 1, url, 'example.com', `result ${index}`]
    );
  }
}

/** 一个已收录（会被 Google 索引）的公开页——蚕食防护的参照物。 */
async function seedPublishedPage(opportunityId: string, indexable = true): Promise<void> {
  await harness.db.query(
    `INSERT INTO public_pages (id, slug, locale, page_type, opportunity_id, status, indexable)
     VALUES ($1, $2, 'en-US', 'OPPORTUNITY', $3, 'PUBLISHED', $4)`,
    [`pg_${opportunityId}`, `${opportunityId}-public`, opportunityId, indexable]
  );
}

/** 所有牵涉「已收录集合」的用例都先清一次，否则结论取决于执行顺序。 */
async function resetPublicPages(): Promise<void> {
  await harness.db.query(`DELETE FROM public_pages`);
}

function urlsFrom(group: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `https://${group}-${i}.example/`);
}

/** 与 `urlsFrom('a', 10)` 恰好共享 `shared` 个结果的 10 元集合。 */
function partnerSharing(shared: number): string[] {
  return [...urlsFrom('a', shared), ...urlsFrom('b', 10 - shared)];
}

/** 跑一次发布，并把机会页那一行读回来。 */
async function publish(opportunityId: string) {
  const decision = await harness.services.PublicPublicationService.publishOpportunity(opportunityId);
  const row = (
    await harness.db.query<{ status: string; indexable: boolean; eligibility: any; content: any }>(
      `SELECT status, indexable, eligibility, content FROM public_pages
        WHERE opportunity_id = $1 AND locale = 'en-US'`,
      [opportunityId]
    )
  ).rows[0];
  return { decision, row };
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
});

after(async () => {
  await harness.teardown();
});

describe('条件① 已失去抢跑价值（15 §3 第 1 条、18 §4.1）', () => {
  it('公开页 content 记录 STALE_DATA，供归档页展示宽限期提示', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedOpportunity({ id: 'opp_stale_pub', verdict: 'PASS' });
    await seedVerdicts('opp_stale_pub', [[0, 'PASS', ['STALE_DATA']], [2, 'WATCH'], [5, 'BUILD_NOW']]);

    const { row } = await publish('opp_stale_pub');
    assert.equal(row.content.stale, true);
  });

  it('**活跃阻断**：最新裁决仍是 BUILD_NOW / EARLY_BET 时永不公开，哪怕生命周期已写成竞争态', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedOpportunity({ id: 'opp_a1', verdict: 'BUILD_NOW', lifecycle: 'CONTESTED' });
    await seedVerdicts('opp_a1', [[0, 'BUILD_NOW']]);

    const { decision, row } = await publish('opp_a1');
    assert.equal(decision.eligible, false);
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.eligibility.admission.basis, null);
    assert.deepEqual(row.eligibility.blockedBy, ['ACTIVE_WINDOW']);
    assert.equal(row.eligibility.admission.latestVerdict, 'BUILD_NOW');
  });

  it('**失去价值即公开**：四种 basis 各走一次，凭据写出是哪一条', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();

    const cases: Array<
      ['opp_a2_closing' | 'opp_a2_pass' | 'opp_a2_life' | 'opp_a2_idle', 'closing' | 'pass' | 'lifecycle' | 'inactive', string]
    > = [
      ['opp_a2_closing', 'closing', 'WINDOW_CLOSING'],
      ['opp_a2_pass', 'pass', 'PASS'],
      ['opp_a2_life', 'lifecycle', 'LIFECYCLE_CLOSED'],
      ['opp_a2_idle', 'inactive', 'INACTIVE_14D'],
    ];
    for (const [id, kind, expected] of cases) {
      await seedLost(id, kind);
      const { decision, row } = await publish(id);
      assert.equal(decision.eligible, true, `${id} 应当已失去抢跑价值`);
      assert.equal(row.status, 'PUBLISHED');
      assert.equal(row.eligibility.admission.basis, expected);
      assert.deepEqual(row.eligibility.blockedBy, []);
    }
  });

  it('**14 天边界（含端点）**：最后一条活跃裁决在 14 天前放行，13 天前仍阻断', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();

    await seedOpportunity({ id: 'opp_a3a', verdict: 'WATCH' });
    await seedVerdicts('opp_a3a', [
      [0, 'WATCH'],
      [14, 'BUILD_NOW'],
    ]);
    const allowed = await publish('opp_a3a');
    assert.equal(allowed.decision.eligible, true);
    assert.equal(allowed.row.eligibility.admission.basis, 'INACTIVE_14D');
    assert.equal(allowed.row.eligibility.admission.lastActiveVerdictDate, isoDaysAgo(14));

    await seedOpportunity({ id: 'opp_a3b', verdict: 'WATCH' });
    await seedVerdicts('opp_a3b', [
      [0, 'WATCH'],
      [13, 'BUILD_NOW'],
    ]);
    const blocked = await publish('opp_a3b');
    assert.equal(blocked.decision.eligible, false);
    assert.deepEqual(blocked.row.eligibility.blockedBy, ['ACTIVE_WINDOW']);
    assert.equal(blocked.row.status, 'DRAFT');
  });

  it('**非单调撤回**：公开后重新活跃 → 同一轮发布立刻翻回 DRAFT', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();

    // 第一步：窗口关闭 → 公开。
    await seedOpportunity({ id: 'opp_a4', verdict: 'WINDOW_CLOSING' });
    await seedVerdicts('opp_a4', [
      [2, 'WINDOW_CLOSING'],
      [3, 'BUILD_NOW'],
    ]);
    const first = await publish('opp_a4');
    assert.equal(first.decision.eligible, true);
    assert.equal(first.row.status, 'PUBLISHED');

    // 第二步：新的裁决把它打回活跃（BUILD_NOW）。同一轮 S8 重算资格 → DRAFT。
    await seedVerdicts('opp_a4', [[1, 'BUILD_NOW']]);
    const revoked = await publish('opp_a4');
    assert.equal(revoked.decision.eligible, false);
    assert.equal(revoked.row.status, 'DRAFT', '重新活跃的机会必须从公开页撤回');
    assert.deepEqual(revoked.row.eligibility.blockedBy, ['ACTIVE_WINDOW']);

    // 第三步：再关窗（更新的裁决） → 重新公开。状态是"当前事实"，不是单向棘轮。
    await seedVerdicts('opp_a4', [[0, 'WINDOW_CLOSING']]);
    const again = await publish('opp_a4');
    assert.equal(again.decision.eligible, true);
    assert.equal(again.row.status, 'PUBLISHED');
  });
});

describe('条件② 证据充足性（15 §3 第 2 条）', () => {
  it('已失去价值但 M 轴 INSUFFICIENT → 不公开', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedLost('opp_b1', 'closing', { mBand: 'INSUFFICIENT' });

    const { decision, row } = await publish('opp_b1');
    assert.equal(decision.eligible, false);
    assert.deepEqual(row.eligibility.blockedBy, ['M_INSUFFICIENT']);
    assert.equal(row.eligibility.evidence.sufficient, false);
  });
});

describe('条件③ 蚕食防护（15 §3 第 3 条）', () => {
  /** 已失去价值的候选 + 一条已收录的参照页，两者的 PRIMARY 各有一份 SERP 快照。 */
  async function seedCannibalizationFixture(candidateId: string, neighbourId: string, overlap: number) {
    await seedLost(candidateId, 'closing');
    await seedPrimaryWithSerp(candidateId, urlsFrom('a', 10));
    await seedOpportunity({ id: neighbourId, verdict: 'BUILD_NOW' });
    await seedPrimaryWithSerp(neighbourId, partnerSharing(overlap));
    await seedPublishedPage(neighbourId);
  }

  it('重叠 8/10 → 通过（0.667 < 0.7）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedCannibalizationFixture('opp_c1', 'opp_c1n', 8);

    const { decision, row } = await publish('opp_c1');
    assert.equal(row.eligibility.cannibalization.status, 'PASSED');
    assert.equal(row.eligibility.cannibalization.closestSlug, 'opp_c1n-public');
    assert.ok(row.eligibility.cannibalization.maxJaccard < 0.7);
    assert.equal(decision.eligible, true);
  });

  it('重叠 9/10 → 阻断（0.818 >= 0.7）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedCannibalizationFixture('opp_c2', 'opp_c2n', 9);

    const { decision, row } = await publish('opp_c2');
    assert.equal(row.eligibility.cannibalization.status, 'BLOCKED');
    assert.ok(row.eligibility.cannibalization.maxJaccard >= 0.7);
    assert.deepEqual(row.eligibility.blockedBy, ['CANNIBALIZATION']);
    assert.equal(decision.eligible, false);
    assert.equal(row.status, 'DRAFT');
  });

  it('没有已收录页 → VACUOUS（而不是"数据缺失"）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedLost('opp_c3', 'closing');
    await seedPrimaryWithSerp('opp_c3', urlsFrom('a', 10));

    const { decision, row } = await publish('opp_c3');
    assert.equal(row.eligibility.cannibalization.status, 'VACUOUS');
    assert.equal(row.eligibility.cannibalization.publishedPages, 0);
    assert.deepEqual(row.eligibility.blockedBy, []);
    assert.equal(decision.eligible, true, '没有可蚕食的对象就该放行');
  });

  it('已收录页但 indexable = false（未过质检）不计入参照集合', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedCannibalizationFixture('opp_c4', 'opp_c4n', 10); // 10/10，若被计入必然阻断
    await harness.db.query(`UPDATE public_pages SET indexable = false WHERE opportunity_id = $1`, ['opp_c4n']);

    const { decision, row } = await publish('opp_c4');
    // 口径是"会被 Google 收录的页"（与 sitemap.ts 同款）。
    assert.equal(row.eligibility.cannibalization.status, 'VACUOUS');
    assert.equal(decision.eligible, true);
  });

  it('候选拿不到 SERP 快照 → NOT_EVALUATED，fail-closed 且显式登记', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedLost('opp_c5', 'closing'); // 候选**没有** PRIMARY query / SERP
    await seedOpportunity({ id: 'opp_c5n', verdict: 'BUILD_NOW' });
    await seedPrimaryWithSerp('opp_c5n', urlsFrom('z', 10));
    await seedPublishedPage('opp_c5n');

    const { decision, row } = await publish('opp_c5');
    assert.equal(row.eligibility.cannibalization.status, 'NOT_EVALUATED');
    assert.deepEqual(row.eligibility.notEvaluated, ['cannibalization']);
    assert.deepEqual(row.eligibility.blockedBy, ['CANNIBALIZATION_DATA_MISSING']);
    assert.equal(decision.eligible, false, 'fail-closed：查不成就别发');
  });
});

describe('资格凭据的形状（03 §15、18 §4.1）', () => {
  it('凭据写出 basis 与三个事实，且不再含已废除的 delayDays / ageDays', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedLost('opp_d1', 'closing');

    const { row } = await publish('opp_d1');
    const eligibility = row.eligibility;
    assert.equal(eligibility.version, 1);
    assert.equal(typeof eligibility.evaluatedAt, 'string');
    assert.equal(eligibility.eligible, true);
    assert.equal(eligibility.admission.basis, 'WINDOW_CLOSING');
    assert.equal(eligibility.admission.latestVerdict, 'WINDOW_CLOSING');
    assert.equal(eligibility.admission.lifecycle, 'EARLY_WINDOW');
    assert.equal(typeof eligibility.admission.lastActiveVerdictDate, 'string');
    assert.ok(eligibility.evidence);
    assert.deepEqual(eligibility.blockedBy, []);
    // 这两个键留着等于在凭据里写下一个已经不存在的判据。
    assert.equal('delayDays' in eligibility, false);
    assert.equal('ageDays' in eligibility, false);
  });

  it('公开页正文写真实词根：v3.1 没有任何打码路径', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedLost('opp_d2', 'pass');

    const { row } = await publish('opp_d2');
    assert.ok(JSON.stringify(row.content).includes(KEYWORD));
    assert.equal(row.content.isStealthMasked, undefined);
  });
});

function isoDaysAgo(n: number): string {
  // 必须与数据库的 CURRENT_DATE 用同一套本地日历。用 toISOString() 的 UTC 日期，
  // 在本地凌晨（UTC 还是前一天）会得到差一天的期望值。
  const date = new Date();
  date.setDate(date.getDate() - n);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
