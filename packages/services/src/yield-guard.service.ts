import { query } from '@emeradar/db';
import { AuditService } from './audit.service';

/** PRD §1.7 第 4 条 / 05 §7：BUILD_NOW 存量占已发布机会的上限（默认 5%）。 */
export const BUILD_NOW_TARGET_SHARE_MAX = 0.05;
export const YIELD_WINDOW_DAYS = 7;

export interface YieldGuardResult {
  asOf: string;
  newPublishedInWindow: number;
  floorBreached: boolean;
  /** 窗口内每天的 BUILD_NOW 存量占比（无已发布机会的日子为 null）。 */
  dailyShares: Array<number | null>;
  ceilingBreached: boolean;
  alertsRaised: string[];
}

/**
 * 产出守卫（05 §7.2，30 R13）。
 *
 * **只告警，不改任何配置。** 阈值调整必须走 DRAFT → SHADOW → ACTIVE，自动校准会让
 * H1 评估的对象在观测期内被改写。所以这里不写 scoring 配置，只写 audit_log 与
 * Admin 站内通知。两个守卫单位不同、分开监控：下限看每周新增条数，上限看存量占比。
 */
export class YieldGuardService {
  static async check(asOf: string = new Date().toISOString().slice(0, 10)): Promise<YieldGuardResult> {
    // 下限：窗口内首次进入 BUILD_NOW / EARLY_BET 的机会数（只看 v2 纪元账本行）。
    const floor = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT v.opportunity_id, MIN(v.obs_date) AS first_day
           FROM verdicts v
          WHERE v.hash_version >= 2 AND v.verdict IN ('BUILD_NOW','EARLY_BET')
          GROUP BY v.opportunity_id
       ) f
       WHERE f.first_day > ($1::date - $2::int) AND f.first_day <= $1::date`,
      [asOf, YIELD_WINDOW_DAYS]
    );
    const newPublishedInWindow = floor.rows[0]?.n ?? 0;
    const floorBreached = newPublishedInWindow === 0;

    // 上限：逐日取每个机会截至当日的最新裁决，算 BUILD_NOW 占比；连续 7 天都超限才算。
    const shareRes = await query<{ day: string; total: number; build_now: number }>(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COUNT(l.opportunity_id)::int AS total,
              COUNT(*) FILTER (WHERE l.verdict = 'BUILD_NOW')::int AS build_now
         FROM generate_series($1::date - ($2::int - 1), $1::date, interval '1 day') AS d(day)
         LEFT JOIN LATERAL (
           SELECT DISTINCT ON (v.opportunity_id) v.opportunity_id, v.verdict
             FROM verdicts v
            WHERE v.hash_version >= 2 AND v.obs_date <= d.day::date
            ORDER BY v.opportunity_id, v.obs_date DESC
         ) l ON TRUE
        GROUP BY d.day
        ORDER BY d.day`,
      [asOf, YIELD_WINDOW_DAYS]
    );
    const dailyShares = shareRes.rows.map((r) => (r.total > 0 ? r.build_now / r.total : null));
    const ceilingBreached =
      dailyShares.length === YIELD_WINDOW_DAYS &&
      dailyShares.every((s) => s !== null && s > BUILD_NOW_TARGET_SHARE_MAX);

    const alertsRaised: string[] = [];
    if (floorBreached) {
      await YieldGuardService.raise(
        'yield.floor_breached',
        asOf,
        `No new BUILD_NOW or EARLY_BET in the last ${YIELD_WINDOW_DAYS} days. Review the pipeline; threshold changes must go through DRAFT → SHADOW → ACTIVE.`,
        { newPublishedInWindow }
      );
      alertsRaised.push('yield.floor_breached');
    }
    if (ceilingBreached) {
      await YieldGuardService.raise(
        'yield.ceiling_breached',
        asOf,
        `BUILD_NOW exceeded ${BUILD_NOW_TARGET_SHARE_MAX * 100}% of published opportunities for ${YIELD_WINDOW_DAYS} consecutive days. Review the thresholds through the SHADOW process.`,
        { dailyShares }
      );
      alertsRaised.push('yield.ceiling_breached');
    }

    return { asOf, newPublishedInWindow, floorBreached, dailyShares, ceilingBreached, alertsRaised };
  }

  private static async raise(
    action: string,
    asOf: string,
    message: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await AuditService.log({
      actorId: null,
      actorType: 'SYSTEM',
      action,
      targetType: 'scoring_config',
      targetId: null,
      payload: { asOf, ...payload },
    });
    const admins = await query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'`
    );
    const kind = action.replace('yield.', '').replace('_breached', '');
    for (const admin of admins.rows) {
      await query(
        `INSERT INTO notifications (id, user_id, title, body)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [`ntf_yield_${kind}_${asOf}_${admin.id}`, admin.id, `Yield alert (${kind})`, message]
      );
    }
  }
}
