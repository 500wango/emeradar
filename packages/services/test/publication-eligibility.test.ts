import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * `docs/15 §3` 的准实时精选准入判据（Epic 1.7，PRD §7.1 废除 T+45 天延迟后的新口径）。
 *
 * 这些用例只能用夹具验，原因值得写下来：**dev 库里两套判据都选不出任何一条机会**。
 * 那儿 `public_pages` 是 0 行（seed 会清空它），343 条机会全部 ≤14 天、槽位全为
 * `claimed = 0`、卡片只有 `FORMING` / `EARLY_WINDOW`。所以"本地跑起来什么都没变"是
 * 预期的，不能据此推断实现没生效。
 *
 * **每个用例用自己的机会 id。** `verdicts` 挂着只追加触发器，夹具写进去的行永远删不掉
 * ——所以两个用例共用一条机会会在第二个用例上撞主键，而失败原因与被测行为无关。
 * 同理，牵涉「已收录集合」的用例开头都会清一次 `public_pages`，否则结论取决于执行顺序。
 *
 * 用例的价值分布：
 *
 *   1. **硬阻断**——15 §8 把「仍有空余槽位的 BUILD_NOW 出现在公开投影」列为 0 容忍的
 *      P0。旧判据恰恰放过它（只等 45 天，不问槽位），所以这是换判据最直接的收益。
 *   2. **两个分支各自正确**——满额与刚关窗是两条独立的路，凭据必须写对是哪一条。
 *   3. **14 天的时间边界，以及"粘滞"这个陷阱**——`WINDOW_CLOSING` 能带 30 天上限地
 *      延续，所以"裁决是它"与"14 天内新进入"是两件事。
 *   4. **蚕食防护从零实现**——四种状态各自对应不同处置，`VACUOUS` 与 `NOT_EVALUATED`
 *      尤其不能合并。
 *   5. **买断优先没有被新代码挤掉**——打码分支必须仍然早于准入判定。
 */

const harness = makeDisposableDb('emeradar_publication_eligibility_test');

const KEYWORD = 'quixotic-zebra-undertaking';

/** 一条机会 + 卡片。`verdict` 同时写进卡片；账本序列由 `seedVerdicts` 单独给。 */
async function seedOpportunity(opts: {
  id: string;
  verdict: string;
  wBand?: string;
  mBand?: string;
  firstObservedDaysAgo?: number;
}): Promise<void> {
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
     ) VALUES ($1, $2, $3, $4, 'EARLY_WINDOW',
       7000, 6000, 5000, 'HIGH', $5, $6,
       'HIGH', 'TOOL', 'WEEKEND', $3, $3, NOW())`,
    [opts.id, slug, KEYWORD, opts.verdict, opts.mBand ?? 'MEDIUM', opts.wBand ?? 'MEDIUM']
  );
}

/** 账本尾部按倒序给：`[[daysAgo, verdict], ...]`。 */
async function seedVerdicts(opportunityId: string, rows: Array<[number, string]>): Promise<void> {
  const { query } = harness.db;
  for (const [daysAgo, verdict] of rows) {
    const id = `vdt_${opportunityId}_${daysAgo}`;
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence, prev_hash, row_hash)
       VALUES ($1, $2, CURRENT_DATE - $3::int, '1.0', $4, 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', $5, $6)`,
      [id, opportunityId, daysAgo, verdict, '0'.repeat(64), id.padEnd(64, '0').slice(0, 64)]
    );
  }
}

/** 槽位。`capacity`/`claimed` 显式写，因为"满额"正是被测的东西。 */
async function seedSlots(opportunityId: string, capacity: number, claimed: number): Promise<void> {
  await harness.db.query(
    `INSERT INTO opportunity_slots (opportunity_id, archetype, capacity, claimed)
     VALUES ($1, 'TOOL', $2, $3)`,
    [opportunityId, capacity, claimed]
  );
}

/**
 * 满额的机会。它会被判成 `WINDOW_CLOSING`（verdict.ts:170-174），但一次 W 降档都没有。
 *
 * `wcSinceDaysAgo` 用来把这条机会的关窗段做旧：满额旁路进入 `WINDOW_CLOSING` 的机会
 * 与"14 天内新进窗"完全无关，做旧之后凭据里 `windowClosing.fresh` 应当是 false，而
 * 准入仍然成立——这正是"满额与刚关窗是两条独立的路"。
 */
async function seedCrowded(
  id: string,
  opts: { wBand?: string; mBand?: string; firstObservedDaysAgo?: number; wcSinceDaysAgo?: number } = {}
): Promise<void> {
  await seedOpportunity({ id, verdict: 'WINDOW_CLOSING', ...opts });
  await seedSlots(id, 2, 2);
  const since = opts.wcSinceDaysAgo;
  await seedVerdicts(
    id,
    since === undefined
      ? [[0, 'WINDOW_CLOSING']]
      : [
          [0, 'WINDOW_CLOSING'],
          [since, 'WINDOW_CLOSING'],
          [since + 1, 'BUILD_NOW'],
        ]
  );
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

/** 跑一次发布，并把**非打码**那一行读回来。 */
async function publish(opportunityId: string) {
  const decision = await harness.services.PublicPublicationService.publishOpportunity(opportunityId);
  const row = (
    await harness.db.query<{ status: string; indexable: boolean; eligibility: any; content: any }>(
      `SELECT status, indexable, eligibility, content FROM public_pages
        WHERE opportunity_id = $1 AND locale = 'en-US' AND slug NOT LIKE 'stealth-lock-%'`,
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

describe('条件① 抢跑价值已耗尽（15 §3.1）', () => {
  it('**硬阻断**：仍有空槽的 BUILD_NOW 不得公开（15 §8 的 0 容忍线）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedOpportunity({ id: 'opp_a1', verdict: 'BUILD_NOW' });
    await seedSlots('opp_a1', 2, 1);
    await seedVerdicts('opp_a1', [[0, 'BUILD_NOW']]);

    const { decision, row } = await publish('opp_a1');
    assert.equal(decision.eligible, false);
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.eligibility.admission.basis, null);
    assert.deepEqual(row.eligibility.blockedBy, ['OPEN_SLOTS']);
    // 凭据里必须留下当时的槽位状态，否则事后无法回答"为什么这条没公开"。
    assert.deepEqual(row.eligibility.admission.crowdedLocked, {
      slotRows: 1,
      capacity: 2,
      claimed: 1,
      full: false,
    });
  });

  it('满额即公开——哪怕只有 3 天大、W 档还是 HIGH（旧判据两处都会挡）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    // 两处刻意踩在旧判据的禁区内：首见日 3 天前（< 45）、w_band = HIGH（不在旧白名单里）。
    // 关窗段做旧到 20 天前，好让下面的断言说明"两条路彼此独立"。
    await seedCrowded('opp_a2', { wBand: 'HIGH', firstObservedDaysAgo: 3, wcSinceDaysAgo: 20 });

    const { decision, row } = await publish('opp_a2');
    assert.equal(decision.eligible, true, '满额就该公开——这正是 15 §3 自己的例子');
    assert.equal(row.status, 'PUBLISHED');
    assert.equal(row.eligibility.admission.basis, 'CROWDED_LOCKED');
    assert.equal(row.eligibility.admission.crowdedLocked.full, true);
    // 这条机会的关窗段已经 20 天了，"14 天内新进窗"**不成立**，可它照样公开了 ——
    // 两个分支互相独立。这条同时钉住"两分支不可由 verdict 区分"：verdict 都是
    // WINDOW_CLOSING，凭据写了 CROWDED_LOCKED 而不是 WINDOW_CLOSING。
    assert.equal(row.eligibility.admission.windowClosing.current, true);
    assert.equal(row.eligibility.admission.windowClosing.fresh, false);
  });

  it('一个槽位行都没有 ≠ 满额', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedOpportunity({ id: 'opp_a3', verdict: 'BUILD_NOW' });
    await seedVerdicts('opp_a3', [[0, 'BUILD_NOW']]);

    const { decision, row } = await publish('opp_a3');
    assert.equal(decision.eligible, false, '0 >= 0 不是满额');
    assert.equal(row.eligibility.admission.crowdedLocked.slotRows, 0);
    assert.equal(row.eligibility.admission.crowdedLocked.full, false);
    assert.deepEqual(row.eligibility.blockedBy, ['OPEN_SLOTS']);
  });

  it('刚进关窗期（槽位仍开着）也公开，凭据写进入日', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedOpportunity({ id: 'opp_a4', verdict: 'WINDOW_CLOSING' });
    await seedSlots('opp_a4', 2, 0); // 槽位开着，凭的是刚关窗
    await seedVerdicts('opp_a4', [
      [0, 'WINDOW_CLOSING'],
      [4, 'WINDOW_CLOSING'],
      [5, 'BUILD_NOW'],
    ]);

    const { decision, row } = await publish('opp_a4');
    assert.equal(decision.eligible, true);
    assert.equal(row.status, 'PUBLISHED');
    assert.equal(row.eligibility.admission.basis, 'WINDOW_CLOSING');
    assert.equal(row.eligibility.admission.windowClosing.ageDays, 4);
    assert.equal(row.eligibility.admission.windowClosing.fresh, true);
    assert.equal(row.eligibility.admission.windowClosing.freshnessDays, 14);
  });

  it('**14 天边界**：恰好 14 天算新鲜，15 天不算', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();

    await seedOpportunity({ id: 'opp_a5a', verdict: 'WINDOW_CLOSING' });
    await seedSlots('opp_a5a', 2, 0);
    await seedVerdicts('opp_a5a', [
      [0, 'WINDOW_CLOSING'],
      [14, 'WINDOW_CLOSING'],
      [15, 'BUILD_NOW'],
    ]);
    const fresh = await publish('opp_a5a');
    assert.equal(fresh.row.eligibility.admission.windowClosing.ageDays, 14);
    assert.equal(fresh.decision.eligible, true, '含端点：14 天仍算刚进窗');
    assert.equal(fresh.row.status, 'PUBLISHED');

    await seedOpportunity({ id: 'opp_a5b', verdict: 'WINDOW_CLOSING' });
    await seedSlots('opp_a5b', 2, 0);
    await seedVerdicts('opp_a5b', [
      [0, 'WINDOW_CLOSING'],
      [15, 'WINDOW_CLOSING'],
      [16, 'BUILD_NOW'],
    ]);
    const stale = await publish('opp_a5b');
    assert.equal(stale.row.eligibility.admission.windowClosing.ageDays, 15);
    assert.equal(stale.decision.eligible, false, '15 天前关的窗不是"刚"进窗');
    assert.deepEqual(stale.row.eligibility.blockedBy, ['OPEN_SLOTS']);
  });

  it('**粘滞陷阱**：裁决仍是 WINDOW_CLOSING，但已经关了 25 天 → 不公开', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    // verdict.ts:219-223 的迟滞让 WINDOW_CLOSING 能延续到 30 天。只看"裁决是不是它"
    // 会把这条 25 天前就关窗的机会当成准实时精选——而它早已没有抢跑价值可言。
    await seedOpportunity({ id: 'opp_a6', verdict: 'WINDOW_CLOSING' });
    await seedSlots('opp_a6', 2, 0);
    await seedVerdicts('opp_a6', [
      [0, 'WINDOW_CLOSING'],
      [25, 'WINDOW_CLOSING'],
      [26, 'BUILD_NOW'],
    ]);

    const { decision, row } = await publish('opp_a6');
    assert.equal(row.eligibility.admission.windowClosing.current, true, '裁决确实还是它');
    assert.equal(row.eligibility.admission.windowClosing.fresh, false, '但它不是"刚"进窗');
    assert.equal(decision.eligible, false);
  });
});

describe('条件② 证据充足性（15 §3.2）', () => {
  it('满额但 M 轴 INSUFFICIENT → 不公开', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedCrowded('opp_b1', { mBand: 'INSUFFICIENT' });

    const { decision, row } = await publish('opp_b1');
    assert.equal(decision.eligible, false);
    assert.deepEqual(row.eligibility.blockedBy, ['M_INSUFFICIENT']);
    assert.equal(row.eligibility.evidence.sufficient, false);
  });
});

describe('条件③ 蚕食防护（15 §3.3）', () => {
  /** 满额候选 + 一条已收录的参照页，两者的 PRIMARY 各有一份 SERP 快照。 */
  async function seedCannibalizationFixture(candidateId: string, neighbourId: string, overlap: number) {
    await seedCrowded(candidateId);
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
    await seedCrowded('opp_c3');
    await seedPrimaryWithSerp('opp_c3', urlsFrom('a', 10));

    const { decision, row } = await publish('opp_c3');
    assert.equal(row.eligibility.cannibalization.status, 'VACUOUS');
    assert.equal(row.eligibility.cannibalization.publishedPages, 0);
    assert.deepEqual(row.eligibility.blockedBy, []);
    assert.equal(decision.eligible, true, '没有可蚕食的对象就该放行');
  });

  it('已收录页但 indexable = false（打码页）不计入参照集合', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedCannibalizationFixture('opp_c4', 'opp_c4n', 10); // 10/10，若被计入必然阻断
    await harness.db.query(`UPDATE public_pages SET indexable = false WHERE opportunity_id = $1`, ['opp_c4n']);

    const { decision, row } = await publish('opp_c4');
    // 口径是"会被 Google 收录的页"（与 sitemap.ts 同款）：打码页与未过质检的页不进集合。
    assert.equal(row.eligibility.cannibalization.status, 'VACUOUS');
    assert.equal(decision.eligible, true);
  });

  it('候选拿不到 SERP 快照 → NOT_EVALUATED，fail-closed 且显式登记', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedCrowded('opp_c5'); // 候选**没有** PRIMARY query / SERP
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

describe('资格凭据的形状（03 §15）', () => {
  it('含四块凭据，且**不再**含已废除的 delayDays / ageDays', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedCrowded('opp_d1', { wBand: 'HIGH' });

    const { row } = await publish('opp_d1');
    const eligibility = row.eligibility;
    assert.equal(eligibility.version, 1);
    assert.equal(typeof eligibility.evaluatedAt, 'string');
    assert.equal(eligibility.eligible, true);
    assert.equal(eligibility.admission.basis, 'CROWDED_LOCKED');
    assert.ok(eligibility.admission.crowdedLocked, '缺当时槽位状态就无法事后复核');
    assert.ok(eligibility.admission.windowClosing);
    assert.ok(eligibility.evidence);
    assert.deepEqual(eligibility.blockedBy, []);
    // 这两个键留着等于在凭据里写下一个已经不存在的判据。
    assert.equal('delayDays' in eligibility, false);
    assert.equal('ageDays' in eligibility, false);
  });

  it('**反向契约**：本轮的公开页不打码——真实词根照常写进 content', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    await seedCrowded('opp_d2', { wBand: 'HIGH' });

    const { row } = await publish('opp_d2');
    // 与买断轮相反的断言方向：这里**必须**能扫到词根，否则说明准入路径被误打码了。
    assert.ok(JSON.stringify(row.content).includes(KEYWORD), '准实时精选是正常公开投影，不得打码');
    assert.equal(row.content.isStealthMasked, undefined);
  });
});

describe('条件④ 买断封印优先（15 §3.1 第 6 条）', () => {
  it('保护期内的机会走打码分支，不落入准入判定', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await resetPublicPages();
    // 空槽的 BUILD_NOW：准入判定必然判否（OPEN_SLOTS）。这条例子的意义在于"打码分支
    // 必须仍然更早"——顺序写反它就变成 404，而不是 200 的打码页。
    await seedOpportunity({ id: 'opp_e1', verdict: 'BUILD_NOW' });
    await seedSlots('opp_e1', 2, 0);
    await seedVerdicts('opp_e1', [[0, 'BUILD_NOW']]);
    // 先造一条**已经发布**的真实页：买断生效时它必须被翻成 DRAFT（15 §3.1 第 3 条）。
    await harness.db.query(
      `INSERT INTO public_pages (id, slug, locale, page_type, opportunity_id, status, indexable)
       VALUES ('pg_e1_real', 'opp-e1', 'en-US', 'OPPORTUNITY', 'opp_e1', 'PUBLISHED', true)`
    );
    await harness.db.query(
      `INSERT INTO users (id, email, display_name, role, tier)
       VALUES ('usr_pubelig', 'pubelig@emeradar.test', 'pubelig', 'USER', 'PRO')
       ON CONFLICT (id) DO NOTHING`
    );
    await harness.db.query(
      `INSERT INTO stealth_locks (id, opportunity_id, user_id, status, locked_at, unlock_at, amount_usd, provider_payment_id)
       VALUES ('slk_opp_e1', 'opp_e1', 'usr_pubelig', 'ACTIVE', NOW(), NOW() + INTERVAL '60 days', 199.00, 'pi_pubelig')`
    );

    const { decision } = await publish('opp_e1');

    const masked = (
      await harness.db.query<{ slug: string; status: string; indexable: boolean; eligibility: any }>(
        `SELECT slug, status, indexable, eligibility FROM public_pages
          WHERE opportunity_id = 'opp_e1' AND slug LIKE 'stealth-lock-%'`
      )
    ).rows[0];
    assert.ok(masked, '保护期内必须有打码页');
    assert.equal(masked.status, 'PUBLISHED', '打码页不能是 404');
    assert.equal(masked.indexable, false);
    assert.equal(masked.eligibility.reason, 'STEALTH_LOCKED', '打码分支必须早于准入判定');
    assert.equal(decision.indexable, false);

    const real = (
      await harness.db.query<{ status: string }>(
        `SELECT status FROM public_pages WHERE opportunity_id = 'opp_e1' AND slug = 'opp-e1'`
      )
    ).rows[0];
    assert.equal(real.status, 'DRAFT', '真实 slug 那行必须被翻成 DRAFT，否则原页仍可访问');
  });
});
