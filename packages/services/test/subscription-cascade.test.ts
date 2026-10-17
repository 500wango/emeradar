import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * 生命周期事件的连带效应：降级、续订、清扫对告警规则做了什么。
 *
 * 独立成一个文件而不是挂在 subscription-lifecycle.test.ts 后面，是因为一次性库的
 * harness 一个进程里只能 setup 一次（第一次 teardown 就把库删了，第二次 setup 会发现
 * 连接池已经连过而拒绝改写连接串）。两个 describe 共用一个 harness 的写法在这里
 * 是行不通的，不是风格问题。
 */
const harness = makeDisposableDb('emeradar_subscription_cascade_test');

async function subRow(userId: string) {
  const res = await harness.db.query<any>(`SELECT * FROM subscriptions WHERE user_id = $1`, [userId]);
  return res.rows[0] ?? null;
}

/**
 * 降级与续订对告警规则的连带效应。
 *
 * 降级以前只写订阅行：账号掉到 FREE 的一条规则额度，二十条规则继续求值、继续发信。
 * 反方向的错也一样致命 —— "重新订阅"如果无差别地把 `is_active = false` 全部翻回来，
 * 就会连带打开用户当初亲手关掉的告警。`disabled_reason` 存在的全部意义就是把这两种
 * 停用区分开。
 */
const CASCADE_USER = 'usr_lifecycle_cascade';
const DUNNING_USER = 'usr_lifecycle_dunning';
const OPP_ALERTS = 'opp_lifecycle_alerts';

async function seedAlertFixture(userId: string, createdAts: string[], manualOff: number[]) {
  await harness.db.query(`DELETE FROM alert_rules WHERE user_id = $1`, [userId]);
  for (const [index, createdAt] of createdAts.entries()) {
    await harness.db.query(
      `INSERT INTO alert_rules (id, user_id, opportunity_id, rule_type, is_active, disabled_reason, created_at)
       VALUES ($1, $2, $3, 'VERDICT_CHANGE', $4, NULL, $5::timestamptz)`,
      [`alr_${userId}_${index}`, userId, OPP_ALERTS, !manualOff.includes(index), createdAt]
    );
  }
}

async function alertRows(userId: string) {
  return (
    await harness.db.query<{ id: string; is_active: boolean; disabled_reason: string | null; created_at: Date }>(
      `SELECT id, is_active, disabled_reason, created_at FROM alert_rules WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    )
  ).rows;
}

describe('降级与续订的连带效应', () => {
  before(async () => {
    await harness.setup();
    if (!harness.available) return;

    await harness.db.query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ($1, 'lifecycle-alerts', 'Lifecycle alerts', 'TRACKED', '2026-01-01')
       ON CONFLICT (id) DO NOTHING`,
      [OPP_ALERTS]
    );

    for (const [id, daysAgo] of [
      [CASCADE_USER, 3],
      [DUNNING_USER, 3],
    ] as const) {
      await harness.db.query(`DELETE FROM subscriptions WHERE user_id = $1`, [id]);
      await harness.db.query(`DELETE FROM users WHERE id = $1`, [id]);
      await harness.db.query(
        `INSERT INTO users (id, email, display_name, role, tier, status)
         VALUES ($1, $2, $1, 'USER', 'PRO', 'ACTIVE')`,
        [id, `${id}@emeradar.test`]
      );
      await harness.db.query(
        `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start,
           current_period_end, entitlements_snapshot, past_due_since)
         VALUES ($1, $2, 'PRO', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days', '{}'::jsonb, NULL)`,
        [`sub_${id}`, id]
      );
      void daysAgo;
    }
  });

  after(async () => {
    await harness.teardown();
  });

  it('降级把规则封到新上限，保留最早的那些并记下原因', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;

    await seedAlertFixture(CASCADE_USER, [
      '2026-01-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
      '2026-03-01T00:00:00Z',
    ], []);

    await StripeService.deactivateSubscription(CASCADE_USER);

    const rows = await alertRows(CASCADE_USER);
    const active = rows.filter((r) => r.is_active);
    assert.strictEqual(active.length, 0, `FREE 不允许告警，实际活跃 ${active.length} 条`);

    const disabled = rows.filter((r) => !r.is_active);
    assert.strictEqual(disabled.length, 3);
    for (const row of disabled) {
      assert.strictEqual(
        row.disabled_reason,
        'DISABLED_DUE_TO_DOWNGRADE',
        '停用了却没记下原因 —— 重新订阅时就无法区分它和用户手动关掉的规则'
      );
    }
  });

  it('重新订阅只复活系统关掉的，不复活用户亲手关掉的', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;

    // 第 2 条是用户自己关的（reason 为 NULL），第 3 条留给降级去关。
    await seedAlertFixture(CASCADE_USER, [
      '2026-01-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
      '2026-03-01T00:00:00Z',
    ], [1]);
    await StripeService.deactivateSubscription(CASCADE_USER);

    const afterDowngrade = await alertRows(CASCADE_USER);
    assert.strictEqual(afterDowngrade[1].disabled_reason, null, '用户手动关掉的规则被标上了降级原因');
    assert.strictEqual(afterDowngrade[2].disabled_reason, 'DISABLED_DUE_TO_DOWNGRADE');

    await StripeService.activateSubscription(CASCADE_USER, 'PRO', 'monthly', {
      stripeSubscriptionId: `sub_renew_${CASCADE_USER}`,
    });

    const afterUpgrade = await alertRows(CASCADE_USER);
    assert.strictEqual(afterUpgrade[0].is_active, true);
    assert.strictEqual(
      afterUpgrade[1].is_active,
      false,
      '重新订阅把用户亲手关掉的规则也打开了'
    );
    assert.strictEqual(afterUpgrade[1].disabled_reason, null);
    assert.strictEqual(afterUpgrade[2].is_active, true, '系统因降级关掉的规则没有随续订恢复');
    assert.strictEqual(afterUpgrade[2].disabled_reason, null);
  });

  it('清扫把过期的 PAST_DUE 终止，并连跑两次结果一致', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService, SubscriptionLifecycleService } = harness.services;

    await seedAlertFixture(CASCADE_USER, [
      '2026-01-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
      '2026-03-01T00:00:00Z',
    ], []);
    await StripeService.activateSubscription(CASCADE_USER, 'PRO', 'monthly', {
      stripeSubscriptionId: `sub_sweep_${CASCADE_USER}`,
    });
    await harness.db.query(
      `UPDATE subscriptions SET status = 'PAST_DUE', past_due_since = NOW() - INTERVAL '8 days'
        WHERE user_id = $1`,
      [CASCADE_USER]
    );

    const first = await SubscriptionLifecycleService.sweepExpiredSubscriptions(7);
    assert.ok(first.canceled.includes(CASCADE_USER), '宽限期已过尽的订阅没有被终止');
    assert.strictEqual((await subRow(CASCADE_USER)).status, 'CANCELED');
    assert.strictEqual(
      (await harness.db.query<{ tier: string }>(`SELECT tier FROM users WHERE id = $1`, [CASCADE_USER])).rows[0].tier,
      'FREE'
    );
    assert.strictEqual(
      (await alertRows(CASCADE_USER)).filter((r) => r.is_active).length,
      0,
      '终止订阅后告警没有被封顶到 FREE（0 条）'
    );

    const second = await SubscriptionLifecycleService.sweepExpiredSubscriptions(7);
    assert.ok(!second.canceled.includes(CASCADE_USER), '第二次清扫又处理了同一个订阅');
    assert.strictEqual((await alertRows(CASCADE_USER)).filter((r) => r.is_active).length, 0);
  });

  it('催缴标记只写一次（同一天重复跑不会重复发信）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { SubscriptionLifecycleService } = harness.services;

    await harness.db.query(
      `UPDATE subscriptions SET status = 'PAST_DUE', past_due_since = NOW() - INTERVAL '3 days'
        WHERE user_id = $1`,
      [DUNNING_USER]
    );
    await harness.db.query(`DELETE FROM usage_events WHERE user_id = $1`, [DUNNING_USER]);

    const first = await SubscriptionLifecycleService.sendDunningReminders(7);
    assert.strictEqual(first.attempted, 2, '第 3 天应尝试第 1 天与第 3 天两封催缴');
    assert.strictEqual(first.sent, 0, '未配置邮件发送器时不能声称邮件已发出');
    assert.strictEqual(first.failed, 2, '发送失败必须被明确计数');

    const second = await SubscriptionLifecycleService.sendDunningReminders(7);
    assert.strictEqual(second.sent, 0, '重复的清扫又发了一遍催缴邮件');
    assert.strictEqual(second.alreadyMarked, 2);

    const marks = await harness.db.query<{ request_id: string }>(
      `SELECT request_id FROM usage_events WHERE user_id = $1 AND feature = 'DUNNING_REMINDER' ORDER BY request_id`,
      [DUNNING_USER]
    );
    assert.deepStrictEqual(
      marks.rows.map((r) => r.request_id),
      [`dunning:sub_${DUNNING_USER}:d1`, `dunning:sub_${DUNNING_USER}:d3`],
      '催缴标记的键不是「订阅 + 第几天」，于是无法去重'
    );
  });

  it('清扫遇到另一个事务持有订阅锁时报告延期数量', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { SubscriptionLifecycleService } = harness.services;
    await harness.db.query(
      `UPDATE subscriptions SET past_due_since = NOW() - INTERVAL '8 days', status = 'PAST_DUE' WHERE user_id = $1`,
      [DUNNING_USER]
    );
    const other = await harness.db.pool.connect();
    try {
      await other.query('BEGIN');
      await other.query(`SELECT id FROM subscriptions WHERE user_id = $1 FOR UPDATE`, [DUNNING_USER]);
      const result = await SubscriptionLifecycleService.sweepExpiredSubscriptions(7);
      assert.ok(result.scanned >= 1);
      assert.ok(result.deferred >= 1, '锁冲突不是清扫完成，必须可观测');
      assert.ok(!result.canceled.includes(DUNNING_USER));
    } finally {
      await other.query('ROLLBACK');
      other.release();
    }
    const resumed = await SubscriptionLifecycleService.sweepExpiredSubscriptions(7);
    assert.ok(resumed.canceled.includes(DUNNING_USER));
  });
});
