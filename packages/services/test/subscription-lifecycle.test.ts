import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 订阅行的写侧：谁有权判定一个账号是什么套餐。
 *
 * 这一轮把 `subscriptions` 变成了唯一事实源，`users.tier` 降为只写不读的展示镜像。
 * 于是每一个"决定订阅"的写入点都必须同时维护镜像，并且把权益快照写全 —— 否则读侧
 * 会在两个方向上都出问题：
 *
 *   - 只写 `users.tier`（老行为）→ 界面说 PRO、强制按 FREE 执行；
 *   - 只写订阅行、不写镜像 → 界面说 FREE、实际拿到 PRO 权益。
 *
 * 快照这一项还有第三个坑：它是**非空但残缺**时会遮蔽目录。演示库里那三条订阅的
 * `entitlements_snapshot` 只有一个键（`export_reports_monthly`），而读侧的
 * `COALESCE(NULLIF(snapshot,'{}'), plan)` 只把 `'{}'` 当作"没有快照"，于是残缺快照
 * 胜出、`max_projects` 缺失、付费用户被判 1 个项目。所以这里断言快照是**完整**的。
 */
const harness = makeDisposableDb('emeradar_subscription_lifecycle_test');

const USER = 'usr_lifecycle_test';
const SUB_ID = 'sub_stripe_lifecycle_test';

async function freshUser(id: string) {
  await harness.db.query(`DELETE FROM subscriptions WHERE user_id = $1`, [id]);
  await harness.db.query(`DELETE FROM users WHERE id = $1`, [id]);
  await harness.db.query(
    `INSERT INTO users (id, email, display_name, role, tier, status)
     VALUES ($1, $2, $1, 'USER', 'FREE', 'ACTIVE')`,
    [id, `${id}@emeradar.test`]
  );
}

async function subRow(userId: string) {
  const res = await harness.db.query<any>(`SELECT * FROM subscriptions WHERE user_id = $1`, [userId]);
  return res.rows[0] ?? null;
}

describe('订阅写侧：唯一事实源与展示镜像', () => {
  before(async () => {
    await harness.setup();
    if (harness.available) await freshUser(USER);
  });

  after(async () => {
    await harness.teardown();
  });

  it('管理员授权 PRO 落到订阅行，且快照是完整的目录', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { SubscriptionLifecycleService } = harness.services;

    await SubscriptionLifecycleService.applyAdminGrant(USER, 'PRO');

    const row = await subRow(USER);
    assert.ok(row, '授权之后没有订阅行 —— 读侧会按 FREE 执行');
    assert.strictEqual(row.plan_code, 'PRO');
    assert.strictEqual(row.status, 'ACTIVE');

    const catalog = (
      await harness.db.query<{ entitlements: Record<string, unknown> }>(
        `SELECT entitlements FROM plans WHERE code = 'PRO'`
      )
    ).rows[0].entitlements;
    assert.deepStrictEqual(
      Object.keys(row.entitlements_snapshot).sort(),
      Object.keys(catalog).sort(),
      '写下的不是完整快照：缺键会在读侧退化成 ?? 0 的兜底'
    );

    // 手工授权不该静默到期。
    assert.ok(new Date(row.current_period_end).getFullYear() > 9000, '手工授权被设成了会过期的时间');
  });

  it('管理员改回 FREE 是撤回而不是删行（归因锚点要留着）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { SubscriptionLifecycleService } = harness.services;

    await SubscriptionLifecycleService.applyAdminGrant(USER, 'PRO');
    await SubscriptionLifecycleService.applyAdminGrant(USER, 'FREE');

    const row = await subRow(USER);
    assert.ok(row, '订阅行被删掉了：stripe_customer_id 之类的归因线索随之丢失');
    assert.strictEqual(row.status, 'CANCELED');
  });

  it('激活写下完整快照、清掉取消意图，并记住支付意图', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;

    await StripeService.activateSubscription(USER, 'PRO', 'lifetime', {
      stripeCustomerId: 'cus_test_lifecycle',
      stripePaymentIntentId: 'pi_test_lifecycle',
      stripeSubscriptionId: SUB_ID,
    });

    const row = await subRow(USER);
    assert.strictEqual(row.status, 'ACTIVE');
    assert.strictEqual(row.stripe_payment_intent_id, 'pi_test_lifecycle');
    assert.strictEqual(row.cancel_at_period_end, false);
    // 0020 建了这两列；写入方在 activateSubscription，缺了它新购买的终身版
    // 会永远停在默认的 SUBSCRIPTION。
    assert.strictEqual(row.purchase_kind, 'FOUNDING_LIFETIME');
    assert.strictEqual(row.billing_interval, 'MONTH');
    assert.ok(
      Object.keys(row.entitlements_snapshot).length >= 8,
      `快照只有 ${Object.keys(row.entitlements_snapshot).length} 个键，不是完整目录`
    );

    const mirrored = (
      await harness.db.query<{ tier: string }>(`SELECT tier FROM users WHERE id = $1`, [USER])
    ).rows[0].tier;
    assert.strictEqual(mirrored, 'PRO', '展示镜像没跟上订阅');
  });

  it('重复激活保持幂等：计费周期锚点不被刷新', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;

    const before = (await subRow(USER)).current_period_start;
    // 结账成功页每次刷新都会走这条路径（verifyAndActivateSession）。
    await StripeService.activateSubscription(USER, 'PRO', 'lifetime', {
      stripeCustomerId: 'cus_test_lifecycle',
      stripeSubscriptionId: SUB_ID,
    });
    const after = (await subRow(USER)).current_period_start;

    assert.strictEqual(
      new Date(after).toISOString(),
      new Date(before).toISOString(),
      '计费周期锚点被刷新了 —— 配额窗口会随之无声重置'
    );
    // 本次调用没带 payment intent，已记下的那一个不该被抹掉。
    assert.strictEqual((await subRow(USER)).stripe_payment_intent_id, 'pi_test_lifecycle');
  });

  it('季度激活写 QUARTER 与 SUBSCRIPTION，周期末端约 3 个月', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;
    const quarterlyUser = 'usr_lifecycle_quarterly';
    await freshUser(quarterlyUser);

    await StripeService.activateSubscription(quarterlyUser, 'PRO', 'quarterly');

    const row = (await harness.db.query<any>(`SELECT * FROM subscriptions WHERE user_id = $1`, [quarterlyUser])).rows[0];
    assert.strictEqual(row.billing_interval, 'QUARTER');
    assert.strictEqual(row.purchase_kind, 'SUBSCRIPTION');
    const days = (new Date(row.current_period_end).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 80 && days < 100, `季度周期末端应在 ~90 天后，实际 ${days.toFixed(1)}`);
  });

  it('PAST_DUE 起算一次且不重设，恢复时清空', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;

    const userId = await StripeService.updateSubscriptionState(SUB_ID, 'PAST_DUE');
    assert.strictEqual(userId, USER);
    const first = (await subRow(USER)).past_due_since;
    assert.ok(first, 'PAST_DUE 没有开始计时 —— 7 天宽限永远走不完');

    // 催缴期间 Stripe 会重复投递 payment_failed；宽限起点必须钉在第一次。
    await harness.db.query(
      `UPDATE subscriptions SET past_due_since = NOW() - INTERVAL '3 days' WHERE user_id = $1`,
      [USER]
    );
    await StripeService.updateSubscriptionState(SUB_ID, 'PAST_DUE');
    const second = (await subRow(USER)).past_due_since;
    assert.ok(
      new Date(second).getTime() < new Date(first).getTime(),
      '第二次失败把宽限起点重置了 —— 一直失败就能一直不降级'
    );

    // 宽限期内展示镜像仍是付费套餐（窗口的尽头由读侧判定）。
    assert.strictEqual(
      (await harness.db.query<{ tier: string }>(`SELECT tier FROM users WHERE id = $1`, [USER])).rows[0].tier,
      'PRO'
    );

    await StripeService.updateSubscriptionState(SUB_ID, 'ACTIVE');
    assert.strictEqual((await subRow(USER)).past_due_since, null, '恢复后宽限计时没清掉');
  });

  it('CANCELED 让展示镜像跟上（界面不能再自称 PRO）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;

    await StripeService.updateSubscriptionState(SUB_ID, 'CANCELED');
    assert.strictEqual((await subRow(USER)).status, 'CANCELED');
    assert.strictEqual(
      (await harness.db.query<{ tier: string }>(`SELECT tier FROM users WHERE id = $1`, [USER])).rows[0].tier,
      'FREE',
      '订阅已取消而界面仍显示 PRO'
    );
  });
});
