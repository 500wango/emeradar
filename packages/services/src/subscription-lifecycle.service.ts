import { query, transaction } from '@emeradar/db';
import { randomUUID } from 'node:crypto';
import { EntitlementService } from './entitlement.service';
import { sendTransactionalEmail } from './email.service';

/** 订阅行上"不会到期"的哨兵值，与终身版激活用的是同一个。 */
export const NO_EXPIRY = '9999-12-31 23:59:59+00';

type TxClient = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> };

/**
 * 在调用方的事务里读某个套餐的权益目录，用于写 `entitlements_snapshot`。
 *
 * 目录缺失时返回 `null` 而不是抛错：付费激活不该被目录漂移打断，但也绝不能悄悄
 * 过去 —— 没有快照的订阅正是"付费用户落进 `?? 0` 兜底"的成因。所以这里记 ERROR，
 * 由 `migrate` 保证行存在（见 packages/db/src/schema.sql 的 plans 段）。
 */
export async function readPlanEntitlements(
  client: TxClient,
  planCode: string
): Promise<Record<string, unknown> | null> {
  const res = await client.query(`SELECT entitlements FROM plans WHERE code = $1`, [planCode]);
  const entitlements = res.rows[0]?.entitlements;
  if (!entitlements || typeof entitlements !== 'object' || Object.keys(entitlements).length === 0) {
    console.error(
      `[SubscriptionLifecycle] Plan "${planCode}" has no entitlement catalog row; the subscription will fall back to plan-catalog lookups.`
    );
    return null;
  }
  return entitlements as Record<string, unknown>;
}

export class SubscriptionLifecycleService {
  /**
   * 管理员手工改套餐时，把订阅行一起写掉。
   *
   * 这一条是硬需求，不是锦上添花：读侧的权益判定改成**只认 subscriptions** 之后
   * （见 entitlement.service.ts），只写 `users.tier` 的授权会变成静默空操作 ——
   * 界面显示 PRO、实际按 FREE 执行，正是这一轮要消灭的那类分叉。所以授权必须落到
   * 唯一事实源上。
   *
   * 到期的处理：手工授权没有计费周期可言，所以用 NO_EXPIRY 哨兵而不是"一年后"。
   * 给一个运营赠送的账号设一年后到期，等于让它某天被清扫任务静默降级。
   *
   * The admin caller writes users.tier in the same transaction as this grant.
   */
  static async applyAdminGrant(
    userId: string,
    tier: 'FREE' | 'PRO' | 'TEAM'
  ): Promise<void> {
    await transaction(async (client) => {
      const locked = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      if (locked.rows.length === 0) throw new Error(`Cannot grant a plan to missing user ${userId}`);
      await SubscriptionLifecycleService.writeAdminGrant(client, userId, tier);
      await client.query(`UPDATE users SET tier = $2, updated_at = NOW() WHERE id = $1`, [userId, tier]);
    });

    await SubscriptionLifecycleService.reconcileAlerts(userId);
  }

  /** Write the authoritative subscription row using the admin update's transaction. */
  static async writeAdminGrant(
    client: TxClient,
    userId: string,
    tier: 'FREE' | 'PRO' | 'TEAM'
  ): Promise<void> {
    if (tier === 'FREE') {
      // Preserve the row as a Stripe attribution anchor after a manual revocation.
      await client.query(
        `UPDATE subscriptions
            SET status = 'CANCELED', cancel_at_period_end = false, past_due_since = NULL
          WHERE user_id = $1 AND status <> 'CANCELED'`,
        [userId]
      );
      return;
    }

    const snapshot = await readPlanEntitlements(client, tier);
      await client.query(
        `INSERT INTO subscriptions (
           id, user_id, plan_code, status, current_period_start, current_period_end,
           entitlements_snapshot, cancel_at_period_end
         ) VALUES ($1, $2, $3, 'ACTIVE', NOW(), $4::timestamptz, $5::jsonb, false)
         ON CONFLICT (user_id) DO UPDATE SET
           plan_code = EXCLUDED.plan_code,
           status = 'ACTIVE',
           current_period_end = EXCLUDED.current_period_end,
           entitlements_snapshot = EXCLUDED.entitlements_snapshot,
           past_due_since = NULL,
           cancel_at_period_end = false`,
        [`sub_${randomUUID()}`, userId, tier, NO_EXPIRY, JSON.stringify(snapshot ?? {})]
      );
  }

  /**
   * 把用户的告警规则拉回当前套餐允许的条数。
   *
   * 幂等且可随时调用：上限从 `getUserEntitlements` 读（而不是在这里再写一遍判据，
   * 免得两处口径漂移），保留**最早创建**的那些，超出部分停用并记下原因。
   *
   * 关键性质有两个，都是这一轮特意设计的：
   *
   *   1. 只翻 `disabled_reason = 'DISABLED_DUE_TO_DOWNGRADE'` 的行。**用户自己关掉
   *      的规则（reason 为 NULL）永远不会被复活** —— 否则"重新订阅"会悄悄打开一批
   *      用户当初明确关掉的告警，而这正是 schema.sql:620-621 那条无差别谓词留下的
   *      同类教训：一个看不见来源的布尔位承载不了"该不该恢复"这个判断。
   *   2. 候选集把"已因降级停用的"也算进去，并按同样的次序取前 N 条。于是降级再升级
   *      会回到原来的那批规则，而不是换成另一批。
   *
   * 读上限与写入分属两个事务：上限用连接池读（`getUserEntitlements` 自带五条查询），
   * 不值得为此把订阅行锁住。失败方向是安全的 —— 最坏情况是规则多留一会儿，下一次
   * 生命周期事件或清扫会再收一次。
   */
  static async reconcileAlerts(userId: string): Promise<{ restored: number; disabled: number }> {
    const entitlements = await EntitlementService.getUserEntitlements(userId);
    const limit = Math.max(0, entitlements.maxAlerts);

    return transaction(async (client) => {
      // 两个 data-modifying CTE 读到的是同一条语句开始时的快照，且彼此看不见对方的
      // 改动 —— 而候选集与"要停用的集合"是互补的，所以不会有行被两边同时处理。
      const res = await client.query<{ restored: number; disabled: number }>(
        `WITH candidates AS (
           SELECT id FROM alert_rules
            WHERE user_id = $1
              AND (is_active = true OR disabled_reason = 'DISABLED_DUE_TO_DOWNGRADE')
            ORDER BY created_at ASC, id ASC
            LIMIT $2
         ),
         restored AS (
           UPDATE alert_rules
              SET is_active = true, disabled_reason = NULL
            WHERE user_id = $1
              AND disabled_reason = 'DISABLED_DUE_TO_DOWNGRADE'
              AND id IN (SELECT id FROM candidates)
            RETURNING id
         ),
         disabled AS (
           UPDATE alert_rules
              SET is_active = false, disabled_reason = 'DISABLED_DUE_TO_DOWNGRADE'
            WHERE user_id = $1
              AND is_active = true
              AND id NOT IN (SELECT id FROM candidates)
            RETURNING id
         )
         SELECT (SELECT count(*) FROM restored)::int AS restored,
                (SELECT count(*) FROM disabled)::int AS disabled`,
        [userId, limit]
      );
      return res.rows[0] ?? { restored: 0, disabled: 0 };
    });
  }

  /**
   * 到期清扫：把宽限期已过尽的 PAST_DUE 订阅终止掉。
   *
   * 读侧（entitlement.service）已经按 `past_due_since` 自动 fail-closed，所以这里
   * **不是**权益的兜底 —— 它是把状态本身收敛到读侧的判断上，让界面、报表和"用户到底
   * 算不算订阅者"只有一个答案。少了它，库会长期停留在一批"权益早已失效、状态仍写着
   * PAST_DUE"的行上。
   *
   * 逐行 `FOR UPDATE SKIP LOCKED` + 条件 UPDATE（`AND status = 'PAST_DUE'`）：与 webhook
   * 的 `updateSubscriptionState` 线性化。抢先提交的一方赢，另一方的影响行数为 0，
   * 而不是把对方刚写下的 ACTIVE 覆盖成 CANCELED。
   */
  /**
   * 宽限期催缴：第 1/3/7 天各提醒一次（docs/13 §4），到了第 8 天才终止。
   *
   * exactly-once 靠 `usage_events` 的 `UNIQUE(user_id, feature, request_id)`：先抢占
   * 标记，抢到才发信。清扫任务可能一天跑多次（重试、手动触发、多台 worker），而
   * "每天发一次催缴"是个对用户可见的承诺 —— 重复投递不是小瑕疵，它会让这封邮件
   * 变成垃圾邮件，然后用户就再也不看它了。
   *
   * 抢占发生在发信**之前**：发信失败会留下一条已抢占的标记，于是那一天不会重发。
   * 这是刻意的取舍 —— 宁可少发一封，也不要每次重试都再发一封。失败会记 ERROR。
   */
  static async sendDunningReminders(
    graceDays = 7,
    limit = 200
  ): Promise<{ considered: number; attempted: number; sent: number; failed: number; alreadyMarked: number }> {
    const DUNNING_DAYS = [1, 3, 7];

    const due = await query<{
      id: string;
      user_id: string;
      email: string;
      plan_code: string;
      past_due_since: Date;
      days_elapsed: number;
    }>(
      `SELECT s.id, s.user_id, u.email, s.plan_code, s.past_due_since,
              FLOOR(EXTRACT(EPOCH FROM (NOW() - s.past_due_since)) / 86400)::int AS days_elapsed
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
        WHERE s.status = 'PAST_DUE'
          AND s.past_due_since IS NOT NULL
          AND u.status = 'ACTIVE'
        ORDER BY s.past_due_since ASC
        LIMIT $1`,
      [limit]
    );

    let sent = 0;
    let attempted = 0;
    let failed = 0;
    let alreadyMarked = 0;

    for (const row of due.rows) {
      for (const day of DUNNING_DAYS) {
        if (row.days_elapsed < day || day > graceDays) continue;
        const requestId = `dunning:${row.id}:d${day}`;

        const claim = await query<{ id: string }>(
          `INSERT INTO usage_events (id, user_id, feature, units, channel, request_id)
           VALUES ($1, $2, 'DUNNING_REMINDER', 1, 'SYSTEM', $3)
           ON CONFLICT (user_id, feature, request_id) DO NOTHING
           RETURNING id`,
          [`evt_${randomUUID()}`, row.user_id, requestId]
        );
        if (claim.rows.length === 0) {
          alreadyMarked++;
          continue;
        }

        const remaining = Math.max(0, graceDays - row.days_elapsed);
        attempted++;
        const delivered = await sendTransactionalEmail({
          to: row.email,
          subject: `Your Emeradar ${row.plan_code} subscription could not be charged`,
          text:
            `We could not charge the card on file for your ${row.plan_code} subscription.\n\n` +
            `You keep full access for ${remaining} more day(s). After that the account returns to the ` +
            `free plan — your data stays, but paid limits and real-time alerts stop.\n\n` +
            `Update your payment method to keep your plan active.`,
        });
        if (!delivered) {
          failed++;
          console.error(
            `[SubscriptionLifecycle] Dunning reminder d${day} for ${row.user_id} was not delivered; ` +
              'the day is marked as used and will not be retried.'
          );
        } else {
          sent++;
        }
      }
    }

    return { considered: due.rows.length, attempted, sent, failed, alreadyMarked };
  }

  static async sweepExpiredSubscriptions(
    graceDays = 7,
    limit = 200
  ): Promise<{ scanned: number; deferred: number; canceled: string[] }> {
    // Reminders first: cancelling someone whose dunning mail never went out is the
    // silent-loss-of-access case the grace window exists to prevent.
    await SubscriptionLifecycleService.sendDunningReminders(graceDays, limit).catch((error) => {
      console.error('[SubscriptionLifecycle] Dunning reminders failed; continuing with the sweep:', error);
    });

    const due = await query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM subscriptions
        WHERE status = 'PAST_DUE'
          AND past_due_since IS NOT NULL
          AND past_due_since < NOW() - ($1 || ' days')::interval
        ORDER BY past_due_since ASC
        LIMIT $2`,
      [String(graceDays), limit]
    );

    const canceled: string[] = [];
    let deferred = 0;
    for (const row of due.rows) {
      const done = await transaction(async (client) => {
        const locked = await client.query<{ user_id: string }>(
          `SELECT user_id FROM subscriptions WHERE id = $1 FOR UPDATE SKIP LOCKED`,
          [row.id]
        );
        // 另一条路径（webhook / 另一台 worker）正拿着这一行，或者它已经不是
        // PAST_DUE 了：都跳过，让下一次清扫再看。
        if (locked.rows.length === 0) return { userId: null, deferred: true };

        const updated = await client.query<{ user_id: string }>(
          `UPDATE subscriptions
              SET status = 'CANCELED'
            WHERE id = $1 AND status = 'PAST_DUE'
            RETURNING user_id`,
          [row.id]
        );
        if (updated.rows.length === 0) return { userId: null, deferred: false };

        await client.query(`UPDATE users SET tier = 'FREE', updated_at = NOW() WHERE id = $1`, [
          updated.rows[0].user_id,
        ]);
        return { userId: updated.rows[0].user_id, deferred: false };
      });

      if (done.deferred) deferred++;
      if (done.userId) canceled.push(done.userId);
    }

    // 告警封顶放在状态写入之后、逐用户进行：它在自己的事务里跑，失败只影响那一户，
    // 不会让已经终止的订阅回滚。
    for (const userId of canceled) {
      await SubscriptionLifecycleService.reconcileAlerts(userId).catch((error) => {
        console.error(`[SubscriptionLifecycle] reconcileAlerts failed for ${userId}:`, error);
      });
    }

    if (deferred > 0) console.warn(`[SubscriptionLifecycle] ${deferred} due subscriptions were locked; retry next sweep.`);
    return { scanned: due.rows.length, deferred, canceled };
  }
}
