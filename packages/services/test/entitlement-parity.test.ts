import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * The quota a user is *shown* and the quota that is *enforced* must come from the
 * same reading of the database.
 *
 * They used to be resolved by four near-identical queries that had drifted apart,
 * and the drift was not cosmetic: `getUserEntitlements` ignored TRIALING and read
 * the plan from `users.tier` when a subscription row was missing, while the
 * reserve* paths resolved it differently. Each divergence meant the UI reported a
 * limit the API did not honour — in either direction.
 *
 * This file now also pins the *source of truth* itself. `subscriptions` is it;
 * `users.tier` is a display mirror. The tests below are written so that reading
 * the mirror would fail them: a tier-only account is FREE no matter what
 * `users.tier` claims, and an expired or cancelled subscription grants nothing
 * even though its row still exists.
 *
 * Uses a disposable database rather than the migrated dev one: several cases need
 * subscriptions in states the dev database does not have (expired, day-3 and
 * day-8 PAST_DUE), and writing those into a shared database would leave rows that
 * other suites then read.
 */
const harness = makeDisposableDb('emeradar_entitlement_parity_test');

const FREE_USER = 'usr_parity_free';
const TIER_ONLY = 'usr_parity_tier_only'; // users.tier = TEAM, no subscription
const TRIAL_USER = 'usr_parity_trial';
const EXPIRED_USER = 'usr_parity_expired';
const CANCELED_USER = 'usr_parity_canceled';
const PAST_DUE_DAY3 = 'usr_parity_pastdue_d3';
const PAST_DUE_DAY8 = 'usr_parity_pastdue_d8';
const LIFETIME_USER = 'usr_parity_lifetime';

async function makeUser(id: string, tier: string) {
  await harness.db.query(
    `INSERT INTO users (id, email, display_name, role, tier, status)
     VALUES ($1, $2, $1, 'USER', $3, 'ACTIVE')`,
    [id, `${id}@emeradar.test`, tier]
  );
}

async function makeSubscription(
  userId: string,
  planCode: 'FREE' | 'PRO' | 'TEAM',
  status: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED',
  periodEndSql: string,
  pastDueSql?: string
) {
  await harness.db.query(
    `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start,
       current_period_end, entitlements_snapshot, past_due_since)
     VALUES ($1, $2, $3, $4, NOW(), ${periodEndSql}, '{}'::jsonb, ${pastDueSql ?? 'NULL'})`,
    [`sub_${userId}`, userId, planCode, status]
  );
}

describe('权益口径：订阅表是唯一事实源', () => {
  before(async () => {
    await harness.setup();
    if (!harness.available) return;

    await makeUser(FREE_USER, 'FREE');
    await makeUser(TIER_ONLY, 'TEAM'); // 库里的展示镜像自称 TEAM，但没有订阅行
    await makeUser(TRIAL_USER, 'FREE');
    await makeUser(EXPIRED_USER, 'PRO');
    await makeUser(CANCELED_USER, 'PRO');
    await makeUser(PAST_DUE_DAY3, 'PRO');
    await makeUser(PAST_DUE_DAY8, 'PRO');
    await makeUser(LIFETIME_USER, 'FREE');

    await makeSubscription(TRIAL_USER, 'PRO', 'TRIALING', `NOW() + INTERVAL '7 days'`);
    // 已付至昨天：展示镜像还写着 PRO，订阅也还是 ACTIVE —— 但周期已经走完。
    await makeSubscription(EXPIRED_USER, 'PRO', 'ACTIVE', `NOW() - INTERVAL '1 day'`);
    await makeSubscription(CANCELED_USER, 'PRO', 'CANCELED', `NOW() + INTERVAL '20 days'`);
    await makeSubscription(PAST_DUE_DAY3, 'PRO', 'PAST_DUE', `NOW() - INTERVAL '3 days'`, `NOW() - INTERVAL '3 days'`);
    await makeSubscription(PAST_DUE_DAY8, 'PRO', 'PAST_DUE', `NOW() - INTERVAL '8 days'`, `NOW() - INTERVAL '8 days'`);
    // 终身版：一次性付款，周期到 9999。
    await makeSubscription(LIFETIME_USER, 'PRO', 'ACTIVE', `TIMESTAMPTZ '9999-12-31 23:59:59+00'`);
  });

  after(async () => {
    await harness.teardown();
  });

  it('没有订阅行就只有 FREE —— users.tier 不再能授权', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { EntitlementService } = harness.services;

    const shown = await EntitlementService.getUserEntitlements(TIER_ONLY);
    assert.strictEqual(shown.planCode, 'FREE', '仅凭 users.tier 就拿到了付费套餐');

    // 强制侧必须与展示侧同口径：展示说 FREE，就不能实际放行 PRO 的额度。
    const reserved = await EntitlementService.reserveLiveScanQuota(TIER_ONLY);
    assert.strictEqual(reserved.limit, shown.liveScanDailyLimit, '展示与强制的日扫描额度不一致');

    // FREE 层无自动化功能（PRD §8.1：免费层不支持自动化追踪与告警）
    assert.strictEqual(shown.maxProjects, 0);
    assert.strictEqual(shown.maxAlerts, 0);
  });

  it('TRIALING 两端一致地算作有权益', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { EntitlementService } = harness.services;

    const shown = await EntitlementService.getUserEntitlements(TRIAL_USER);
    assert.strictEqual(shown.planCode, 'PRO');
    assert.strictEqual(shown.opportunityDetailFull, true);

    const reserved = await EntitlementService.reserveLiveScanQuota(TRIAL_USER);
    assert.strictEqual(reserved.limit, shown.liveScanDailyLimit);
  });

  it('已付至昨天的 ACTIVE 订阅不再授予 PRO（fail-closed）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { EntitlementService } = harness.services;

    const shown = await EntitlementService.getUserEntitlements(EXPIRED_USER);
    assert.strictEqual(shown.planCode, 'FREE', '过期订阅仍在授权 —— webhook 或清扫任务一停就无限续期');
    assert.strictEqual(shown.maxProjects, 0);
    assert.strictEqual(shown.renewsAt, null, '过期订阅不该报出续费日');

    const reserved = await EntitlementService.reserveLiveScanQuota(EXPIRED_USER);
    assert.strictEqual(reserved.limit, shown.liveScanDailyLimit);
  });

  it('CANCELED 订阅不再授予任何付费权益', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { EntitlementService } = harness.services;

    const shown = await EntitlementService.getUserEntitlements(CANCELED_USER);
    assert.strictEqual(shown.planCode, 'FREE');
    assert.strictEqual(shown.maxProjects, 0);
    assert.strictEqual(shown.renewsAt, null);
  });

  it('PAST_DUE 第 3 天仍有 PRO，第 8 天自动落回 FREE', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { EntitlementService } = harness.services;

    const day3 = await EntitlementService.getUserEntitlements(PAST_DUE_DAY3);
    assert.strictEqual(day3.planCode, 'PRO', '宽限期内被提前断供');
    // 0020 起 PRO 的项目上限是 50（20 §6）。
    assert.strictEqual(day3.maxProjects, 50);
    // 宽限期内没有任何"下一次续费"，周期末端已经在过去。
    assert.strictEqual(day3.renewsAt, null, '宽限期内报出了一个已经过去的续费日');

    const day8 = await EntitlementService.getUserEntitlements(PAST_DUE_DAY8);
    assert.strictEqual(day8.planCode, 'FREE', '宽限期结束后仍按 PRO 授权 —— 一直不付款就能一直用');
    assert.strictEqual(day8.maxProjects, 0);

    // 宽限期的尽头由数据决定，不需要任何任务跑过。
    const reserved = await EntitlementService.reserveLiveScanQuota(PAST_DUE_DAY8);
    assert.strictEqual(reserved.limit, day8.liveScanDailyLimit);
  });

  it('终身版（付至 9999）维持 PRO', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { EntitlementService } = harness.services;

    const shown = await EntitlementService.getUserEntitlements(LIFETIME_USER);
    assert.strictEqual(shown.planCode, 'PRO');
    assert.ok(shown.renewsAt, '终身版没有续费日可报（应是 9999），但也不该是 null');
  });

  it('残缺的权益快照不再遮蔽目录', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { EntitlementService } = harness.services;

    // 演示库与所有存量订阅行的形状：非空，但只有一个键。
    await harness.db.query(
      `UPDATE subscriptions SET entitlements_snapshot = '{"export_reports_monthly": 30}'::jsonb
        WHERE user_id = $1`,
      [PAST_DUE_DAY3]
    );

    const shown = await EntitlementService.getUserEntitlements(PAST_DUE_DAY3);
    assert.strictEqual(shown.exportReportsMonthlyLimit, 30, '快照定义过的键没有被尊重');
    assert.strictEqual(shown.maxProjects, 50, '快照没定义的键没有回落目录 —— 付费用户被按 0 个项目处理');
    assert.strictEqual(shown.maxAlerts, 20);
  });

  it('后台列表报的套餐与权益判定逐字相同', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { AdminService, EntitlementService } = harness.services;

    const { items } = await AdminService.listUsers({ limit: 100 });
    const byId = new Map(items.map((i) => [i.id, i]));

    // 逐个对拍：展示侧（后台列表）与强制侧（权益解析）必须给出同一个套餐码。
    // 这里刻意包含 CANCELED 与已过期的账号 —— 它们正是旧实现分叉的地方：列表读的
    // 是"最近一条订阅行"，不看状态，于是已退订的账号在后台仍显示 PRO，而产品其余
    // 部分早已按 FREE 服务。运营据此判断谁在付费，这是最不能有两套口径的一屏。
    for (const userId of [FREE_USER, TIER_ONLY, TRIAL_USER, EXPIRED_USER, CANCELED_USER, PAST_DUE_DAY3, PAST_DUE_DAY8, LIFETIME_USER]) {
      const item = byId.get(userId);
      assert.ok(item, `后台列表没有返回 ${userId}`);
      const effective = await EntitlementService.getUserEntitlements(userId);
      assert.strictEqual(
        item.subscriptionPlanCode,
        effective.planCode,
        `${userId}：后台显示 ${item.subscriptionPlanCode}，实际按 ${effective.planCode} 服务`
      );
    }

    // 具体断言三个方向，避免"两边都错得一样"也能通过。
    assert.strictEqual(byId.get(CANCELED_USER)!.subscriptionPlanCode, 'FREE', '已退订账号在后台仍显示付费套餐');
    assert.strictEqual(byId.get(CANCELED_USER)!.hasActiveSubscription, false);
    assert.strictEqual(byId.get(TIER_ONLY)!.subscriptionPlanCode, 'FREE', '仅凭 users.tier 的账号在后台显示为付费');
    // 宽限期内仍在服务，所以"有订阅"这一点在后台也必须为真；把旗标读成
    // status = 'ACTIVE' 会把昨天扣款失败的客户显示成已退订。
    assert.strictEqual(byId.get(PAST_DUE_DAY3)!.subscriptionPlanCode, 'PRO');
    assert.strictEqual(byId.get(PAST_DUE_DAY3)!.hasActiveSubscription, true, '宽限期内的账号被显示成没有订阅');
    assert.strictEqual(byId.get(PAST_DUE_DAY8)!.hasActiveSubscription, false, '宽限期结束仍在后台显示为订阅中');
  });

  it('配额窗口锚定计费周期，而不是自然月', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { EntitlementService } = harness.services;

    // 纯函数部分：滚动前进、月末收敛。
    assert.strictEqual(
      EntitlementService.quotaPeriodStart(new Date('2026-01-31T00:00:00Z'), new Date('2026-02-15T00:00:00Z')),
      '2026-01-31',
      '同一个月内应停在锚点本身'
    );
    assert.strictEqual(
      EntitlementService.quotaPeriodStart(new Date('2026-01-31T00:00:00Z'), new Date('2026-03-05T00:00:00Z')),
      '2026-02-28',
      '锚点是 31 号时，2 月的窗口起点应收敛到月末而不是溢出到 3 月'
    );
    assert.strictEqual(
      EntitlementService.quotaPeriodStart(new Date('2026-01-20T00:00:00Z'), new Date('2026-06-25T00:00:00Z')),
      '2026-06-20',
      '窗口必须随月份滚动前进，否则计数器永远不会重置'
    );
    assert.strictEqual(
      EntitlementService.quotaPeriodStart(new Date('2026-06-20T00:00:00Z'), new Date('2026-06-19T00:00:00Z')),
      '2026-06-20',
      '今天早于锚点日时不应回退到上一个月'
    );

    // 端到端：计费窗口起点（20 日）与自然月（1 日）必须给出不同的键。
    await harness.db.query(
      `UPDATE subscriptions SET current_period_start = date_trunc('month', NOW() - INTERVAL '1 month') + INTERVAL '19 days'
        WHERE user_id = $1`,
      [TRIAL_USER]
    );
    await EntitlementService.reserveLiveScanQuota(TRIAL_USER); // 只用到日额度，不写月计数器
    await EntitlementService.reserveReportGenerationQuota(TRIAL_USER, 'opp_parity');

    const row = (
      await harness.db.query<{ period_start: string }>(
        `SELECT period_start::text FROM usage_counters
          WHERE user_id = $1 AND feature = 'GENERATE_REPORT'`,
        [TRIAL_USER]
      )
    ).rows[0];
    assert.ok(row, '生成配额没有写下计数器');
    assert.notStrictEqual(
      row.period_start.slice(8),
      '01',
      '配额窗口仍按自然月结算，用户会在自己的计费日之前拿到新额度'
    );
  });
});
