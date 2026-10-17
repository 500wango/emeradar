import { randomUUID } from 'node:crypto';
import { query, transaction } from '@emeradar/db';
import { AuditService } from './audit.service';

export const GUARANTEE_WINDOW_DAYS = 14;
export const GUARANTEE_EXTENSION_DAYS = 7;

export interface GuaranteeResult {
  asOf: string;
  triggered: boolean;
  alreadyGranted: boolean;
  subscriptionsExtended: number;
}

/**
 * 兜底承诺（PRD v2.2 Q7）：连续 14 天全平台没有任何合格 BUILD_NOW / EARLY_BET 行时，
 * 所有活跃 Pro 订阅自动延长 7 天。
 *
 * 「合格」= v2 纪元账本里 verdict 为 BUILD_NOW 或 EARLY_BET 的行（含延续，不要求新增）：
 * 承诺的是「这两周你能看到可做的机会」，不是「这两周有新增」。终身版的到期哨兵值不动。
 * 补偿只给时长；以 `window_end` 唯一约束保证同一窗口只补偿一次。
 *
 * 局限：Stripe 续费事件会按供应商给的周期末覆盖 `current_period_end`，所以延长对周期订阅
 * 只在当前周期内有效，不保证跨过下一次续费。要永久生效需要同步调整 Stripe 侧的试用/周期，
 * 不在本任务范围。
 */
export class OutputGuaranteeService {
  static async check(asOf: string = new Date().toISOString().slice(0, 10)): Promise<GuaranteeResult> {
    const qualified = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM verdicts
        WHERE hash_version >= 2 AND verdict IN ('BUILD_NOW','EARLY_BET')
          AND obs_date > ($1::date - $2::int) AND obs_date <= $1::date`,
      [asOf, GUARANTEE_WINDOW_DAYS]
    );
    // 账本在窗口内必须真有行：没有任何裁决行说明管线没跑，那是另一类故障，不是「零产出」。
    const anyRows = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM verdicts
        WHERE hash_version >= 2 AND obs_date > ($1::date - $2::int) AND obs_date <= $1::date`,
      [asOf, GUARANTEE_WINDOW_DAYS]
    );
    const triggered = (qualified.rows[0]?.n ?? 0) === 0 && (anyRows.rows[0]?.n ?? 0) > 0;
    if (!triggered) return { asOf, triggered: false, alreadyGranted: false, subscriptionsExtended: 0 };

    return transaction(async (client) => {
      const grant = await client.query(
        `INSERT INTO output_guarantee_grants (id, window_end, window_days, subscriptions_extended)
         VALUES ($1, $2::date, $3, 0) ON CONFLICT (window_end) DO NOTHING RETURNING id`,
        [`ogg_${randomUUID()}`, asOf, GUARANTEE_WINDOW_DAYS]
      );
      if (grant.rows.length === 0) {
        return { asOf, triggered: true, alreadyGranted: true, subscriptionsExtended: 0 };
      }
      const extended = await client.query(
        `UPDATE subscriptions
            SET current_period_end = current_period_end + make_interval(days => $1)
          WHERE plan_code = 'PRO' AND status = 'ACTIVE'
            AND current_period_end > NOW()
            AND current_period_end < TIMESTAMPTZ '9999-01-01'`,
        [GUARANTEE_EXTENSION_DAYS]
      );
      const count = extended.rowCount ?? 0;
      await client.query(`UPDATE output_guarantee_grants SET subscriptions_extended = $2 WHERE window_end = $1::date`, [asOf, count]);
      await AuditService.log({
        actorId: null,
        actorType: 'SYSTEM',
        action: 'guarantee.extended',
        targetType: 'subscriptions',
        payload: { asOf, windowDays: GUARANTEE_WINDOW_DAYS, extensionDays: GUARANTEE_EXTENSION_DAYS, subscriptionsExtended: count },
      });
      return { asOf, triggered: true, alreadyGranted: false, subscriptionsExtended: count };
    });
  }
}
