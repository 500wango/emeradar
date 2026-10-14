import { query, transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { EntitlementService } from './entitlement.service';
import {
  type AlertRuleType,
  UNIMPLEMENTED_RULE_TYPES,
  isEvaluatedRuleType,
} from './alert-triggers';
import { hiddenFromViewer } from './stealth-lock-policy';

export type { AlertRuleType };

export interface CreateAlertRuleInput {
  opportunityId: string;
  ruleType: AlertRuleType;
  frequency?: 'IMMEDIATE' | 'DAILY' | 'WEEKLY';
}

export class AlertService {
  /**
   * List alert rules for a user
   */
  static async listAlertRules(userId: string): Promise<any[]> {
    /**
     * 买断保护期内，非持有者的规则**从列表里消失**（10 §7 的「一切读取路径」）。
     *
     * `createAlertRule` 那道闸只挡得住"现在去建一条"，挡不住"买断之前就建好了"：
     * 规则是用户自己在机会还可见时建的，锁生效之后它照样在库里，而这条查询会把
     * `o.title` / `o.slug` 原样带出来——标题就是打码要遮的那件东西。
     *
     * 这里是**排除行**而不是像公开战报那样打码，理由在 `r.*`：行里带着
     * `opportunity_id`，而本库的机会 id 直接嵌了 slug（`opp_adsense_rpm_simulator`），
     * 只把标题换成 `[Stealth Locked #…]` 等于把词根留在同一行的另一个字段里。要打码
     * 就得连 id 一起换，而 id 是这一行的外键、也是 UI 的跳转目标——那不如不返回。
     *
     * 排除是无害的：保护期内的投递本来就被 pipeline 抑制（持有者之外不推送），
     * 所以这条规则在这段时间里是哑的；期满 `hiddenFromViewer` 转假，它原样回来。
     */
    const res = await query<any>(
      `SELECT r.*, o.title as opportunity_title, o.slug as opportunity_slug,
              c.verdict as current_verdict
       FROM alert_rules r
       JOIN opportunities o ON o.id = r.opportunity_id
       LEFT JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE r.user_id = $1
         AND ${hiddenFromViewer('r.opportunity_id', '$2')}
       ORDER BY r.created_at DESC`,
      [userId, userId]
    );
    return res.rows;
  }

  /**
   * Create an alert rule with quota checking
   */
  static async createAlertRule(
    userId: string,
    input: CreateAlertRuleInput
  ): Promise<any> {
    /**
     * 只能订阅真的会被求值的类型。
     *
     * 从前这里放行全部四种，而每日流水线只求值 VERDICT_CHANGE —— 用户能建出
     * NEW_ENTRANT / KILL_CRITERIA 规则，规则安静地躺在库和列表页里，永远不响。
     * 静默失效比明确的"暂不支持"更糟：用户以为自己被盯着。
     */
    if (!isEvaluatedRuleType(input.ruleType)) {
      throw new EmeradarError(
        ErrorCode.VALIDATION_ERROR,
        UNIMPLEMENTED_RULE_TYPES[input.ruleType] ??
          `Unsupported alert rule type: ${input.ruleType}`,
        400
      );
    }

    /**
     * 这是一个**存在性判据**，所以保护期内的处置必须与"这条机会不存在"完全同形。
     *
     * 若这里放行，一个非持有者只要试着建一条规则，就能从"成功"与"404"的差别里
     * 问出"这条机会是不是正被买断"——而这恰好是 D3 用 404 想挡住的那条信息。
     * 持有者照常放行：他的告警盯的是自己买下的东西。
     */
    const opportunityRes = await query<{ id: string }>(
      `SELECT o.id
       FROM opportunities o
       JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE o.id = $1 AND o.status = 'TRACKED'
         AND ${hiddenFromViewer('o.id', '$2')}`,
      [input.opportunityId, userId]
    );
    if (opportunityRes.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Published opportunity not found: ${input.opportunityId}`,
        404
      );
    }

    return transaction(async (client) => {
      // Serialize the quota check and insert for this user/opportunity/rule.
      // Repeated clicks return the existing rule instead of creating duplicates.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${userId}:${input.opportunityId}:${input.ruleType}`,
      ]);
      const existing = await client.query<any>(
        `SELECT * FROM alert_rules
         WHERE user_id = $1 AND opportunity_id = $2 AND rule_type = $3
         ORDER BY created_at DESC LIMIT 1`,
        [userId, input.opportunityId, input.ruleType]
      );
      if (existing.rows[0]) {
        if (!existing.rows[0].is_active) {
          const ent = await EntitlementService.getUserEntitlements(userId);
          const countRes = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM alert_rules WHERE user_id = $1 AND is_active = true`,
            [userId]
          );
          if (Number(countRes.rows[0]?.count ?? 0) >= ent.maxAlerts) {
            throw new EmeradarError(
              ErrorCode.QUOTA_EXCEEDED,
              `Your plan allows up to ${ent.maxAlerts} active alerts. Upgrade to Builder Pro for 20 active alerts.`,
              403,
              { currentAlerts: Number(countRes.rows[0]?.count ?? 0), maxAlerts: ent.maxAlerts }
            );
          }
          const reactivated = await client.query<any>(
            `UPDATE alert_rules SET is_active = true, frequency = $4
             WHERE id = $1 AND user_id = $2 AND opportunity_id = $3
             RETURNING *`,
            [existing.rows[0].id, userId, input.opportunityId, input.frequency || existing.rows[0].frequency]
          );
          return reactivated.rows[0];
        }
        return existing.rows[0];
      }

      const countRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM alert_rules WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      const ent = await EntitlementService.getUserEntitlements(userId);
      const currentAlerts = Number(countRes.rows[0]?.count ?? ent.currentAlertsCount);
      if (currentAlerts >= ent.maxAlerts) {
        throw new EmeradarError(
          ErrorCode.QUOTA_EXCEEDED,
          `Your plan allows up to ${ent.maxAlerts} active alerts. Upgrade to Builder Pro for 20 active alerts.`,
          403,
          { currentAlerts, maxAlerts: ent.maxAlerts }
        );
      }

      const ruleId = `alr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const res = await client.query<any>(
        `INSERT INTO alert_rules (id, user_id, opportunity_id, rule_type, frequency, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING *`,
        [ruleId, userId, input.opportunityId, input.ruleType, input.frequency || 'IMMEDIATE']
      );
      return res.rows[0];
    });
  }

  /**
   * Delete an alert rule
   */
  static async deleteAlertRule(userId: string, ruleId: string): Promise<void> {
    const res = await query(
      `DELETE FROM alert_rules WHERE id = $1 AND user_id = $2`,
      [ruleId, userId]
    );
    if (res.rowCount === 0) {
      throw new EmeradarError(
        ErrorCode.NOT_FOUND,
        `Alert rule not found: ${ruleId}`,
        404
      );
    }
  }

  /**
   * List user notifications
   */
  static async listNotifications(
    userId: string,
    unreadOnly = false
  ): Promise<any[]> {
    const where = unreadOnly
      ? 'user_id = $1 AND is_read = false'
      : 'user_id = $1';

    // 与 `listAlertRules` 同一条规矩：保护期内的历史通知对非持有者不再出现。
    // pipeline 现在不会**新产生**这类通知（非持有者被抑制），但买断之前落库的那几条
    // 仍然带着真实标题与 slug，它们不会自己消失。
    //
    // `LEFT JOIN` 保持不变：`opportunity_id IS NULL` 的系统通知在 `NOT EXISTS` 下
    // 天然保留（子查询匹配不到任何锁行），不会被这条判据误伤。
    const res = await query<any>(
      `SELECT n.*, o.slug as opportunity_slug, o.title as opportunity_title
       FROM notifications n
       LEFT JOIN opportunities o ON o.id = n.opportunity_id
       WHERE ${where}
         AND ${hiddenFromViewer('n.opportunity_id', '$2')}
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [userId, userId]
    );

    return res.rows;
  }

  /**
   * Mark notification as read
   */
  static async markNotificationRead(
    userId: string,
    notificationId: string
  ): Promise<void> {
    await query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
  }
}
