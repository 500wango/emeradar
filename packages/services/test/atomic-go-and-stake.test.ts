import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Epic 1.10（槽位 + 原子 GO）与 Epic 1.13（承诺质押）的验收用例。
 *
 * 这两块共享同一条不变量：**槽位是一份有限且可被抢的资源**。所以要验的不是"函数
 * 返回了成功"，而是两件只有在并发与时间流逝下才显形的事：
 *   1. 同一形态的最后一个席位被 N 个人同时抢，结果必须恰好有一个赢家，其余三个
 *      拿到的必须是 409 而不是 500；而输家的失败要**完全**回滚——不留项目、不留
 *      决策、不留配额痕迹。
 *   2. 逾期释放收走**槽位**，但不退还**配额**（PRD §1.7 第 5 条）。这一条错了，
 *      "每月 5 次"就变成无限次：占坑、不做事、拿回额度、再占一次。
 *
 * 判据分散在三张表上——`opportunity_slots.claimed`（汇总缓存）、`slot_claims`
 * （真值）、`usage_counters`（配额）——只看任何一张都会得出"没问题"。所以这里自建
 * 一次性数据库、直接操练服务层，而不是只测纯函数或打 API。
 *
 * 每个用例用**自己的**用户与机会。抢占、席位上限、配额都是会累积的状态，共用夹具
 * 会让"谁先跑"决定结果——那样的用例会在改测试顺序时红，而原因与被测行为无关。
 */

const harness = makeDisposableDb('emeradar_atomic_go_test');

// 抢同一席位的一组人：配额给到 50，所以卡住他们的只可能是席位本身。
const CONTENDERS = ['usr_go_c1', 'usr_go_c2', 'usr_go_c3', 'usr_go_c4'];
/** 每月只允许立项一次的套餐：用来把"配额用尽"与"席位上限"分开测。 */
const QUOTA_USER = 'usr_go_quota';
const SLOTS_USER = 'usr_go_slots';
const ARCHIVE_USER = 'usr_go_archive';
const STAKE_USER = 'usr_go_stake';
/** 质押窗口分档与"首次逾期退额度"专用：自己的用户，不与别的用例共享额度计数。 */
const WINDOW_USER = 'usr_go_window';
/** 免费层：**没有** subscriptions 行，entitlementPlanJoin 会把它落到 FREE。 */
const FREE_USER = 'usr_go_free';
/** 配额充裕、但目录里**没有** active_go_slots_max 键的套餐。 */
const NO_KEY_USER = 'usr_go_no_slots_key';

const PLAN_ONE_SHOT = 'TEST_ONE_SHOT_GO';
const PLAN_TWO_SLOTS = 'TEST_TWO_SLOTS';
const PLAN_NO_SLOTS_KEY = 'TEST_NO_SLOTS_KEY';

const OPP_SOLO = 'opp_go_solo'; // 容量 1：最后一个席位只有一个，抢才成立。
const OPP_FIRST = 'opp_go_first'; // 配额用户第一次成功 GO 的落点。
const OPP_QUOTA = 'opp_go_quota';
const OPP_SLOTS_A = 'opp_go_slots_a';
const OPP_SLOTS_B = 'opp_go_slots_b';
const OPP_ARCHIVE = 'opp_go_archive';
const OPP_STAKE = 'opp_go_stake';
/** 执行规模 M / L 的机会，用来验质押窗口按规模取 14 / 21 天。 */
const OPP_WINDOW_M = 'opp_go_window_m';
const OPP_WINDOW_L = 'opp_go_window_l';
/** 期限还在未来的一条机会：用来把"提交失败"与"逾期"分开验。 */
const OPP_VERIFY = 'opp_go_verify';
const OPP_PROBE = 'opp_go_probe';

/**
 * 探针的解析器替身。真实 DNS 没法按需返回内网地址或空结果，而"拦住了没有"恰恰是
 * 这道闸唯一值得测的东西（见 `public-url.ts` 的 `lookupImpl` 说明）。
 */
const isIpLiteral = (hostname: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');

const resolvePublic = async (hostname: string) =>
  isIpLiteral(hostname)
    ? [{ address: hostname, family: 4 }]
    : [{ address: '93.184.216.34', family: 4 }];
const resolvePrivate = async () => [{ address: '10.0.0.7', family: 4 }];
const resolveNothing = async () => [];

/** 可编程的 fetch 替身：按 URL 返回预置响应。 */
function stubFetch(routes: Record<string, { status?: number; html?: string; location?: string }>): typeof fetch {
  return (async (input: any) => {
    const url = typeof input === 'string' ? input : input.toString();
    const route = routes[url];
    if (!route) throw new Error(`stub fetch: no route for ${url}`);
    return new Response(route.html ?? '', {
      status: route.status ?? 200,
      headers: route.location ? { location: route.location } : {},
    });
  }) as typeof fetch;
}

const TERMS = ['invoice generator', 'pdf invoice'];

/**
 * 一次性数据库夹具的文件级唯一一对钩子。
 *
 * 夹具建库、改写连接池、并在 setup 里断言池还没连过任何连接，所以每个文件只能
 * setup 一次——放进各个 describe 会让第二组用例撞上已存在的库。三个 describe 共用
 * 同一份库，靠**各自的用户与机会**而不是靠钩子来隔离。
 */
before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await seedFixture();
});

after(async () => {
  await harness.teardown();
});

const SLOT_FIXTURES: Array<[string, string]> = [
  // [机会 id, 主裁决 id]
  [OPP_SOLO, 'vdt_go_solo'],
  [OPP_FIRST, 'vdt_go_first'],
  [OPP_QUOTA, 'vdt_go_quota'],
  [OPP_SLOTS_A, 'vdt_go_slots_a'],
  [OPP_SLOTS_B, 'vdt_go_slots_b'],
  [OPP_ARCHIVE, 'vdt_go_archive'],
  [OPP_STAKE, 'vdt_go_stake'],
  [OPP_VERIFY, 'vdt_go_verify'],
  [OPP_PROBE, 'vdt_go_probe'],
  [OPP_WINDOW_M, 'vdt_go_window_m'],
  [OPP_WINDOW_L, 'vdt_go_window_l'],
];

function verdictOf(opportunityId: string): string {
  const found = SLOT_FIXTURES.find(([id]) => id === opportunityId);
  if (!found) throw new Error(`no fixture verdict for ${opportunityId}`);
  return found[1];
}

async function seedFixture() {
  const { query } = harness.db;

  for (const [code, name, entitlements] of [
    [PLAN_ONE_SHOT, 'One Shot', '{"atomic_go_export_monthly":1,"active_go_slots_max":10,"max_projects":50}'],
    [PLAN_TWO_SLOTS, 'Two Slots', '{"atomic_go_export_monthly":50,"active_go_slots_max":2,"max_projects":50}'],
    // 故意缺 `active_go_slots_max`：读侧必须失败关闭，而不是兜一个默认值。
    [PLAN_NO_SLOTS_KEY, 'No Slots Key', '{"atomic_go_export_monthly":5}'],
  ] as const) {
    await query(
      `INSERT INTO plans (code, name, price_usd_monthly, entitlements)
       VALUES ($1, $2, 0.00, $3::jsonb) ON CONFLICT (code) DO NOTHING`,
      [code, name, entitlements]
    );
  }

  const subscribers: Array<[string, string]> = [
    ...CONTENDERS.map((id) => [id, PLAN_TWO_SLOTS] as [string, string]),
    [QUOTA_USER, PLAN_ONE_SHOT],
    [SLOTS_USER, PLAN_TWO_SLOTS],
    [ARCHIVE_USER, PLAN_TWO_SLOTS],
    [STAKE_USER, PLAN_TWO_SLOTS],
    [WINDOW_USER, PLAN_TWO_SLOTS],
    [NO_KEY_USER, PLAN_NO_SLOTS_KEY],
  ];
  for (const [id, plan] of subscribers) {
    await query(
      `INSERT INTO users (id, email, display_name, role, tier) VALUES ($1, $2, $3, 'USER', 'PRO')`,
      [id, `${id}@emeradar.test`, id]
    );
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_end)
       VALUES ($1, $2, $3, 'ACTIVE', NOW() + INTERVAL '30 days')`,
      [`sub_${id}`, id, plan]
    );
  }
  await query(
    `INSERT INTO users (id, email, display_name, role, tier) VALUES ($1, $2, $3, 'USER', 'FREE')`,
    [FREE_USER, `${FREE_USER}@emeradar.test`, FREE_USER]
  );

  for (const [opportunityId, verdictId] of SLOT_FIXTURES) {
    const slug = opportunityId.replace(/_/g, '-');
    // 只有 OPP_SOLO 是容量 1 —— 最后一个席位要真的只有一个。
    const capacity = opportunityId === OPP_SOLO || opportunityId === OPP_FIRST ||
      opportunityId === OPP_SLOTS_A || opportunityId === OPP_SLOTS_B
      ? 1
      : 2;
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ($1, $2, $3, 'TRACKED', '2026-01-01')`,
      [opportunityId, slug, slug]
    );
    await query(
      `INSERT INTO opportunity_slots (opportunity_id, archetype, capacity) VALUES ($1, 'TOOL', $2)`,
      [opportunityId, capacity]
    );
    // 主词就是探针要匹配的那个词（`opportunityTerms` 读的是这个字段）。
    await query(
      `INSERT INTO opportunity_cards (
         opportunity_id, slug, primary_query, verdict, lifecycle,
         d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band,
         confidence, recommended_archetype, execution_class, why_now_summary,
         top_idea, first_observed_at
       ) VALUES ($1, $2, 'invoice generator', 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', 'HIGH', 'HIGH',
         'HIGH', 'TOOL', 'WEEKEND', 'fixture', 'fixture', NOW())`,
      [opportunityId, slug]
    );
    // verdicts 挂着只追加触发器，所以一次性数据库是唯一能造裁决的地方。
    // verdicts 的列很少：档位在 `opportunity_cards` 上，账本里存的是基点与置信度。
    // 与 decision-traceability 的夹具保持同一形状，免得两处对"一条裁决长什么样"
    // 各说各话。prev_hash 留全零：这条链的起点。
    await query(
      `INSERT INTO verdicts (id, opportunity_id, obs_date, scoring_config_version, verdict,
         lifecycle, d_basis_points, m_basis_points, w_basis_points, confidence,
         prev_hash, row_hash)
       VALUES ($1, $2, CURRENT_DATE, '1.0', 'BUILD_NOW', 'EARLY_WINDOW',
         7000, 6000, 5000, 'HIGH', $3, $4)`,
      [verdictId, opportunityId, '0'.repeat(64), verdictId.padEnd(64, '0')]
    );
  }
}

/** 该用户已消耗的原子立项次数。 */
async function quotaUsed(userId: string): Promise<number> {
  const res = await harness.db.query<{ used: number }>(
    `SELECT used FROM usage_counters WHERE user_id = $1 AND feature = 'atomic_go_export_monthly'`,
    [userId]
  );
  return res.rows[0]?.used ?? 0;
}

/** 一次 GO 的最短写法。 */
function go(userId: string, opportunityId: string, options?: { now?: Date }) {
  return harness.services.DecisionService.goAndExport(
    userId,
    { opportunityId, archetype: 'TOOL', verdictId: verdictOf(opportunityId) },
    options
  );
}

describe('原子 GO：并发与配额', () => {
  it('四个人同时抢同一个形态的最后一个席位，恰好一个成功，其余三个是 409', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    const results = await Promise.allSettled(CONTENDERS.map((userId) => go(userId, OPP_SOLO)));

    const winners = results.filter((result) => result.status === 'fulfilled');
    assert.strictEqual(winners.length, 1, `最后一个席位被 ${winners.length} 个人拿到`);

    // 输的三个必须是 409 SLOT_TAKEN。让并发失败泄漏成 500，等于把"别人先到了"
    // 这个正常结果报成产品故障；而 409 的 `details.alternatives` 是失败方唯一能
    // 据以行动的信息（还有哪儿能去），所以它必须存在且可机读。
    for (const result of results) {
      if (result.status === 'fulfilled') continue;
      const error = result.reason;
      assert.strictEqual(error?.code, 'SLOT_TAKEN', `意外的失败码：${error?.code} ${error?.message}`);
      assert.strictEqual(error?.status, 409);
      assert.deepStrictEqual(error?.details?.alternatives, []);
    }

    // 汇总缓存与真值必须一致（I11）。抢占只该让 claimed 从 0 走到 1。
    const slots = await harness.services.SlotService.getSlots(OPP_SOLO);
    assert.deepStrictEqual(slots.slots, [{ archetype: 'TOOL', capacity: 1, claimed: 1, remaining: 0 }]);
    assert.strictEqual(slots.totalClaimed, 1);

    const claims = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM slot_claims WHERE opportunity_id = $1 AND state = 'CLAIMED'`,
      [OPP_SOLO]
    );
    assert.strictEqual(claims.rows[0].count, 1, 'slot_claims 里出现了多条活跃认领');

    // 输家的失败必须是**完全**回滚。只回滚槽位而留下项目或扣掉的配额，会让这三个
    // 人各自带着一条来源不明的项目和一次凭空消失的月度额度。
    const losers = CONTENDERS.filter((_, index) => results[index].status === 'rejected');
    assert.strictEqual(losers.length, 3);

    const strayProjects = await query<{ user_id: string }>(
      `SELECT user_id FROM projects WHERE opportunity_id = $1 AND user_id = ANY($2::text[])`,
      [OPP_SOLO, losers]
    );
    assert.deepStrictEqual(strayProjects.rows, [], '抢输的人留下了项目');

    const strayDecisions = await query<{ user_id: string }>(
      `SELECT user_id FROM decisions WHERE opportunity_id = $1 AND user_id = ANY($2::text[])`,
      [OPP_SOLO, losers]
    );
    assert.deepStrictEqual(strayDecisions.rows, [], '抢输的人留下了决策');

    const strayQuota = await query<{ user_id: string }>(
      `SELECT user_id FROM usage_counters
        WHERE feature = 'atomic_go_export_monthly' AND user_id = ANY($1::text[])`,
      [losers]
    );
    assert.deepStrictEqual(strayQuota.rows, [], '抢输的人被扣了配额');
  });

  it('免费层拿不到槽位：403 PLAN_REQUIRED，且不留下任何痕迹', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    await assert.rejects(
      () => go(FREE_USER, OPP_QUOTA),
      (error: any) => {
        assert.strictEqual(error?.code, 'PLAN_REQUIRED');
        assert.strictEqual(error?.status, 403);
        // 升级引导必须随错误一起回来：免费层要做的下一步是"换套餐"，不是"重试"。
        // 形状是 `{required_plan, url}`（RFC9457 载荷的 `upgrade`），不是裸字符串。
        assert.deepStrictEqual(error?.upgrade, { required_plan: 'FREE', url: '/pricing' });
        return true;
      },
      '免费层被允许占用槽位'
    );

    // 配额是**第一道**闸：它必须在建项目、写决策之前就把事务推出去。反过来
    // （先建项目再发现没额度）会让免费层的每次尝试都往库里落一行再回滚。
    const projects = await query(`SELECT id FROM projects WHERE user_id = $1`, [FREE_USER]);
    assert.deepStrictEqual(projects.rows, []);
    const decisions = await query(`SELECT id FROM decisions WHERE user_id = $1`, [FREE_USER]);
    assert.deepStrictEqual(decisions.rows, []);
    const usage = await query(`SELECT * FROM usage_counters WHERE user_id = $1`, [FREE_USER]);
    assert.deepStrictEqual(usage.rows, []);

    assert.strictEqual((await harness.services.SlotService.getSlots(OPP_QUOTA)).totalClaimed, 0);
  });

  it('配额用尽后第二次 GO 是 403 QUOTA_EXCEEDED，第二个项目不会被建出来', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;

    // QUOTA_USER 在 TEST_ONE_SHOT_GO 下每月只能立项一次。
    const first = await go(QUOTA_USER, OPP_FIRST);
    assert.ok(first.projectId);
    assert.ok(first.launchKitUrl.includes(first.projectId), '点火包地址没有指向这次落地的项目');
    assert.ok(new Date(first.stakeDeadlineAt).getTime() > Date.now(), '质押期限不是一个未来时间');

    await assert.rejects(
      () => go(QUOTA_USER, OPP_QUOTA),
      (error: any) => {
        assert.strictEqual(error?.code, 'QUOTA_EXCEEDED');
        assert.strictEqual(error?.status, 403);
        assert.strictEqual(error?.details?.limit, 1);
        return true;
      },
      '配额用尽后仍然立出了第二个项目'
    );

    const projects = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects WHERE user_id = $1`,
      [QUOTA_USER]
    );
    assert.strictEqual(projects.rows[0].count, 1, '失败的 GO 增加了项目数');

    // 第二条机会的槽位也不该被碰过。
    assert.strictEqual((await harness.services.SlotService.getSlots(OPP_QUOTA)).totalClaimed, 0, '失败的 GO 占了槽位');
  });

  it('活跃席位上限是独立的一道闸：第 3 个 GO 得 409 ACTIVE_SLOTS_EXCEEDED', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { SlotService } = harness.services;

    // TEST_TWO_SLOTS 的 active_go_slots_max 是 2、配额 50——所以卡住它的必然是
    // 席位而不是额度。这正是本例要确认的分工：两者是不同的闸，给的是不同的引导。
    await go(SLOTS_USER, OPP_SLOTS_A);
    await go(SLOTS_USER, OPP_SLOTS_B);
    assert.strictEqual(await SlotService.countActiveClaims(SLOTS_USER), 2);

    await assert.rejects(
      () => go(SLOTS_USER, OPP_ARCHIVE),
      (error: any) => {
        assert.strictEqual(error?.code, 'ACTIVE_SLOTS_EXCEEDED');
        assert.strictEqual(error?.status, 409);
        assert.deepStrictEqual(error?.details, { active: 2, slotsMax: 2 });
        return true;
      },
      '第 3 个活跃席位被放行'
    );

    // 被拒之后席位计数不该发生变化。
    assert.strictEqual(await SlotService.countActiveClaims(SLOTS_USER), 2);
    assert.strictEqual((await SlotService.getSlots(OPP_ARCHIVE)).totalClaimed, 0);
  });

  it('核验通过的 GO 不再计入活跃席位上限，但仍占着形态槽位（PRD v2.2 Q15）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { SlotService } = harness.services;
    const { query } = harness.db;

    // 上一例之后 SLOTS_USER 已有 2 个质押未核验的 GO，正好顶到上限。
    assert.strictEqual(await SlotService.countActiveClaims(SLOTS_USER), 2);

    // 其中一个质押核验通过：它不再算"活跃"，但槽位本身不释放。
    await query(
      `UPDATE projects SET stake_status = 'VERIFIED' WHERE user_id = $1 AND opportunity_id = $2`,
      [SLOTS_USER, OPP_SLOTS_A]
    );
    assert.strictEqual(await SlotService.countActiveClaims(SLOTS_USER), 1);
    assert.strictEqual(
      (await SlotService.getSlots(OPP_SLOTS_A)).totalClaimed,
      1,
      '核验通过不该释放形态槽位'
    );

    // 腾出了一个活跃名额，第 3 个 GO 因此放行。
    const third = await go(SLOTS_USER, OPP_PROBE);
    assert.ok(third.projectId);
    assert.strictEqual(await SlotService.countActiveClaims(SLOTS_USER), 2);
  });

  it('缺省席位上限失败关闭：目录里读不到 active_go_slots_max 就不给席位', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);

    // 用 `?? 2` 兜底等于给了一个目录里从未授权过的席位上限。额度是钱，席位是
    // 稀缺资源，两者都只能从目录里读；读不到就是 0。
    await assert.rejects(
      () => go(NO_KEY_USER, OPP_PROBE),
      (error: any) => {
        assert.strictEqual(error?.code, 'ACTIVE_SLOTS_EXCEEDED');
        assert.strictEqual(error?.details?.slotsMax, 0);
        return true;
      },
      '缺省席位上限被兜成了一个正数'
    );
  });
});

describe('槽位释放：归档与质押逾期', () => {
  it('归档项目释放槽位，但不退还配额', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { ProjectService, SlotService } = harness.services;
    const { query } = harness.db;

    const started = await go(ARCHIVE_USER, OPP_ARCHIVE);
    assert.strictEqual((await SlotService.getSlots(OPP_ARCHIVE)).totalClaimed, 1);

    await ProjectService.updateProjectStatus(started.projectId, ARCHIVE_USER, 'ARCHIVED');

    const slots = await SlotService.getSlots(OPP_ARCHIVE, ARCHIVE_USER);
    assert.strictEqual(slots.totalClaimed, 0, '归档没有释放槽位');
    assert.strictEqual(slots.myClaim, null);
    assert.strictEqual(await SlotService.countActiveClaims(ARCHIVE_USER), 0);

    const claim = await query<{ state: string; release_reason: string }>(
      `SELECT state, release_reason FROM slot_claims WHERE project_id = $1`,
      [started.projectId]
    );
    assert.strictEqual(claim.rows[0].state, 'RELEASED');
    assert.strictEqual(claim.rows[0].release_reason, 'USER_ARCHIVED');

    // 配额不退：主动归档同样是"占了坑"。退款会让归档变成一次免费的撤回，而
    // "占坑有成本"正是这套机制的全部内容。
    assert.strictEqual(await quotaUsed(ARCHIVE_USER), 1, '归档意外退还了配额');
  });

  it('凭证提交失败不释放槽位；逾期扫描释放槽位但不退配额', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StakeService, SlotService } = harness.services;
    const { query } = harness.db;

    // 先建一条**期限还在未来**的项目。"提交失败不释放槽位"与"逾期释放槽位"是两件
    // 不同的事，只有在期限没到的时候才能验前者——否则 PRECONDITION_FAILED 会先一步
    // 拦下来，用例看上去像是"提交失败了"，实际测的是另一条分支。
    const fresh = await go(STAKE_USER, OPP_VERIFY);
    const freshStatus = await StakeService.getStakeStatus(fresh.projectId, STAKE_USER);
    assert.ok(
      new Date(freshStatus.stakeDeadlineAt).getTime() > Date.now(),
      '夹具的期限没有落在未来'
    );

    // 探针打不开页面、或页面通篇与机会主词无关，都不算上线。但一次填错 URL 也不该
    // 等同于逾期——用户还有到期限为止的时间去改页面，所以槽位必须留着。
    await assert.rejects(
      () =>
        StakeService.submitCredential(
          fresh.projectId,
          STAKE_USER,
          { credentialType: 'DOMAIN_URL', url: 'https://unrelated.example/' },
          {
            lookupImpl: resolvePublic as any,
            fetchImpl: stubFetch({
              'https://unrelated.example/': { status: 200, html: '<title>Handmade candles</title>' },
            }),
          }
        ),
      (error: any) => {
        assert.strictEqual(error?.code, 'CREDENTIAL_UNVERIFIED');
        assert.strictEqual(error?.status, 422);
        // 探针取回的关键字段随错误一起回去：用户要的是"你的标题里没有这几个词"
        // 这类可操作的反馈，而不是"校验失败"四个字。
        assert.strictEqual(error?.details?.probe?.title, 'Handmade candles');
        return true;
      },
      '无关内容的凭证被接受了'
    );
    assert.strictEqual(
      (await SlotService.getSlots(OPP_VERIFY)).totalClaimed,
      1,
      '一次失败的提交就释放了槽位'
    );
    assert.strictEqual(
      (await StakeService.getStakeStatus(fresh.projectId, STAKE_USER)).credentials[0]?.verificationState,
      'REJECTED',
      '失败的提交没有被记下来'
    );

    // 补交一张对得上的，槽位就此保住——顺带把探针的成功路径也走一遍。
    const verified = await StakeService.submitCredential(
      fresh.projectId,
      STAKE_USER,
      { credentialType: 'DOMAIN_URL', url: 'https://built.example/' },
      {
        lookupImpl: resolvePublic as any,
        fetchImpl: stubFetch({
          'https://built.example/': {
            status: 200,
            html: '<title>Invoice Generator</title><h1>PDF invoice</h1>',
          },
        }),
      }
    );
    assert.strictEqual(verified.verified, true);
    assert.strictEqual(
      (await StakeService.getStakeStatus(fresh.projectId, STAKE_USER)).stakeStatus,
      'VERIFIED'
    );

    // 再把 now 拨回 8 天前造一条已经逾期的项目：期限落在 1 天前，不必真等 7 天。
    // 放在后面是因为它一旦存在，`goAndExport` 的 STAKE_REQUIRED 预检就会挡下该用户
    // 之后的所有 GO——那正是那条规则本身，但它会盖住本例前半段要验的东西。
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    const started = await go(STAKE_USER, OPP_STAKE, { now: eightDaysAgo });

    const before = await StakeService.getStakeStatus(started.projectId, STAKE_USER);
    assert.strictEqual(before.stakeStatus, 'PENDING');
    assert.ok(
      new Date(before.stakeDeadlineAt).getTime() < Date.now(),
      '夹具没有造出已经逾期的期限'
    );

    // 扫之前先把配额计数抄下来：要验的是"扫描有没有动它"，而不是某个具体数字
    // ——写死数字会让这条断言在夹具变动时红，而红的原因与被测行为无关。
    const usedBeforeSweep = await quotaUsed(STAKE_USER);

    const swept = await StakeService.releaseExpiredStakes(new Date());
    assert.ok(
      swept.some((row) => row.projectId === started.projectId),
      '逾期扫描没有收走这条项目'
    );
    // 已核验的那条不能跟着被扫走：逾期扫描只该挑 PENDING。
    assert.ok(
      !swept.some((row) => row.projectId === fresh.projectId),
      '逾期扫描动了一条已经核验的项目'
    );

    const slots = await SlotService.getSlots(OPP_STAKE, STAKE_USER);
    assert.strictEqual(slots.totalClaimed, 0, '逾期没有释放槽位');
    assert.strictEqual(slots.myClaim, null);

    const project = await query<{ stake_status: string }>(
      `SELECT stake_status FROM projects WHERE id = $1`,
      [started.projectId]
    );
    assert.strictEqual(project.rows[0].stake_status, 'EXPIRED_RELEASED');

    const claim = await query<{ state: string; release_reason: string }>(
      `SELECT state, release_reason FROM slot_claims WHERE project_id = $1`,
      [started.projectId]
    );
    assert.strictEqual(claim.rows[0].state, 'EXPIRED');
    assert.strictEqual(claim.rows[0].release_reason, 'STAKE_EXPIRED');

    // PRD v2.2 Q5：每位用户**首次**逾期退还 1 次配额，之后不退（退还会把"每月 5 次"
    // 变成无限次，所以只给一次）。这是该用户的第一次逾期，恰好退 1。
    assert.strictEqual(
      await quotaUsed(STAKE_USER),
      usedBeforeSweep - 1,
      '首次逾期应当退还 1 次配额'
    );

    // 逾期之后不能再补交凭证：席位已经给了别人，收下一张凭证只会让项目看起来
    // 在合规状态，而它已经不在任何队列里了。
    await assert.rejects(
      () =>
        StakeService.submitCredential(started.projectId, STAKE_USER, {
          credentialType: 'DOMAIN_URL',
          url: 'https://built.example/',
        }),
      (error: any) => error?.code === 'PRECONDITION_FAILED' && error?.status === 422,
      '逾期释放后仍然接受凭证'
    );
  });

  it('逾期扫描是幂等的：已终结的项目不会被再"释放"一次', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StakeService, SlotService } = harness.services;
    const { query } = harness.db;

    // 扫描是每日作业，会对**全部**历史项目反复执行。第二次运行时那条已终结的项目
    // 必须被跳过：`SlotService.release` 本身对单条记录是幂等的（它带 `state =
    // 'CLAIMED'` 守卫），但扫描若把它重新选进来，就会白白多跑一遍递减路径，而
    // `claimed` 一旦被重复递减，I11 的汇总缓存就与真值分家了。
    const stakeClaim = await query<{ id: string }>(
      `SELECT sc.id FROM slot_claims sc
         JOIN projects p ON p.id = sc.project_id
        WHERE p.stake_status = 'EXPIRED_RELEASED'`
    );
    assert.ok(stakeClaim.rows.length > 0, '夹具里应当已有一条被逾期释放的认领');

    const second = await StakeService.releaseExpiredStakes(new Date());
    assert.deepStrictEqual(second, [], '逾期扫描不是幂等的：已终结的项目被重新处理');

    const after = await query<{ state: string }>(
      `SELECT state FROM slot_claims WHERE id = $1`,
      [stakeClaim.rows[0].id]
    );
    assert.strictEqual(after.rows[0].state, 'EXPIRED', '二次扫描改动了已释放的认领');
    assert.strictEqual((await SlotService.getSlots(OPP_STAKE)).totalClaimed, 0);
  });

  it('质押窗口按执行规模取：M 为 14 天、L 为 21 天（PRD v2.2 Q5）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(`UPDATE opportunities SET execution_class = 'M' WHERE id = $1`, [OPP_WINDOW_M]);
    await query(`UPDATE opportunities SET execution_class = 'L' WHERE id = $1`, [OPP_WINDOW_L]);

    // 同一个 now 造两条项目；now 落在 40 天前，两条都已逾期，供下一个用例直接扫描。
    const now = new Date(Date.now() - 40 * 86_400_000);
    const m = await go(WINDOW_USER, OPP_WINDOW_M, { now });
    const l = await go(WINDOW_USER, OPP_WINDOW_L, { now });

    for (const [projectId, days] of [
      [m.projectId, 14],
      [l.projectId, 21],
    ] as const) {
      const row = await query<{ stake_deadline_at: Date }>(
        `SELECT stake_deadline_at FROM projects WHERE id = $1`,
        [projectId]
      );
      const actualDays = (row.rows[0].stake_deadline_at.getTime() - now.getTime()) / 86_400_000;
      assert.strictEqual(actualDays, days, `质押窗口应为 ${days} 天，实得 ${actualDays}`);
    }
  });

  it('首次逾期退还 1 次配额，之后的逾期不退（PRD v2.2 Q5）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StakeService } = harness.services;
    const { query } = harness.db;

    const usedBefore = await quotaUsed(WINDOW_USER);
    assert.strictEqual(usedBefore, 2, '前一个用例应当扣了两次额度');

    // 上一个用例造的两条项目（14 / 21 天窗口）在 now 之前 40 天开始，此刻都已逾期。
    const swept = await StakeService.releaseExpiredStakes(new Date());
    const mine = swept.filter((row) => row.userId === WINDOW_USER);
    assert.strictEqual(mine.length, 2, '两条逾期项目都应被释放');

    assert.strictEqual(
      await quotaUsed(WINDOW_USER),
      usedBefore - 1,
      '两次逾期合计只应退还 1 次配额'
    );
    const refunds = await query(`SELECT 1 FROM stake_overdue_refunds WHERE user_id = $1`, [WINDOW_USER]);
    assert.strictEqual(refunds.rows.length, 1);
  });
});

describe('凭证探针的网络边界', () => {
  it('拒绝解析到内网地址的目标（SSRF 闸本身）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    await assert.rejects(
      () =>
        probeCredential({
          url: 'https://internal.example/',
          credentialType: 'DOMAIN_URL',
          terms: TERMS,
          lookupImpl: resolvePrivate as any,
          fetchImpl: stubFetch({}),
        }),
      (error: any) => error?.code === 'VALIDATION_ERROR' && error?.status === 400,
      '内网地址没有被拦下'
    );
  });

  it('拒绝解析不出地址的目标', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    await assert.rejects(
      () =>
        probeCredential({
          url: 'https://nxdomain.example/',
          credentialType: 'DOMAIN_URL',
          terms: TERMS,
          lookupImpl: resolveNothing as any,
          fetchImpl: stubFetch({}),
        }),
      (error: any) => error?.code === 'VALIDATION_ERROR',
      '解析不出的域名没有被拦下'
    );
  });

  it('拒绝跳向内网的重定向', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    // 第一跳是公网，Location 指向云元数据端点。只校验入口 URL 的实现会跟过去，
    // 而 169.254.169.254 上放的是实例凭证。
    await assert.rejects(
      () =>
        probeCredential({
          url: 'https://public.example/',
          credentialType: 'DOMAIN_URL',
          terms: TERMS,
          lookupImpl: resolvePublic as any,
          fetchImpl: stubFetch({
            'https://public.example/': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
          }),
        }),
      (error: any) => error?.code === 'VALIDATION_ERROR',
      '重定向到内网没有被拦下'
    );
  });

  it('占位页不算上线，哪怕主词全中', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    const probe = await probeCredential({
      url: 'https://parked.example/',
      credentialType: 'DOMAIN_URL',
      terms: TERMS,
      lookupImpl: resolvePublic as any,
      // 域名停放页会把主词写满标题（它靠这个吃自然流量），所以"命中主词"本身
      // 不足以证明上线——必须先过占位页这一关。
      fetchImpl: stubFetch({
        'https://parked.example/': { status: 200, html: '<title>invoice generator — buy this domain</title>' },
      }),
    });
    assert.strictEqual(probe.ok, false);
    assert.match(String(probe.reason), /placeholder|parking/i);
  });

  it('通篇无关的页面不算上线，并返回实际取到的内容', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    const probe = await probeCredential({
      url: 'https://candles.example/',
      credentialType: 'DOMAIN_URL',
      terms: TERMS,
      lookupImpl: resolvePublic as any,
      fetchImpl: stubFetch({
        'https://candles.example/': { status: 200, html: '<title>Handmade candles</title><h1>Our shop</h1>' },
      }),
    });
    assert.strictEqual(probe.ok, false);
    assert.strictEqual(probe.title, 'Handmade candles');
    assert.deepStrictEqual(probe.matchedTerms, []);
  });

  it('命中主词与簇内词的页面通过', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    const probe = await probeCredential({
      url: 'https://built.example/',
      credentialType: 'DOMAIN_URL',
      terms: TERMS,
      lookupImpl: resolvePublic as any,
      fetchImpl: stubFetch({
        'https://built.example/': {
          status: 200,
          html:
            '<title>Invoice Generator</title>' +
            '<h1>PDF invoice in one click</h1>' +
            '<meta name="description" content="Generate a PDF invoice">',
        },
      }),
    });
    assert.strictEqual(probe.ok, true);
    assert.strictEqual(probe.relevance, 1);
    assert.strictEqual(probe.matchedTerms.length, 2);
    assert.strictEqual(probe.reason, null);
  });

  it('HTTP 错误码不算上线', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    const probe = await probeCredential({
      url: 'https://broken.example/',
      credentialType: 'DOMAIN_URL',
      terms: TERMS,
      lookupImpl: resolvePublic as any,
      fetchImpl: stubFetch({ 'https://broken.example/': { status: 503 } }),
    });
    assert.strictEqual(probe.ok, false);
    assert.strictEqual(probe.httpStatus, 503);
  });

  it('重定向超过上限后放弃，而不是无限跟下去', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { probeCredential } = harness.services;
    const probe = await probeCredential({
      url: 'https://loop.example/1',
      credentialType: 'DOMAIN_URL',
      terms: TERMS,
      lookupImpl: resolvePublic as any,
      fetchImpl: stubFetch({
        'https://loop.example/1': { status: 302, location: 'https://loop.example/2' },
        'https://loop.example/2': { status: 302, location: 'https://loop.example/3' },
        'https://loop.example/3': { status: 302, location: 'https://loop.example/4' },
        'https://loop.example/4': { status: 302, location: 'https://loop.example/5' },
        'https://loop.example/5': { status: 302, location: 'https://loop.example/6' },
      }),
    });
    assert.strictEqual(probe.ok, false);
    assert.match(String(probe.reason), /redirect/i);
  });
});
