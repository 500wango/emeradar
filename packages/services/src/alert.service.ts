import { query, transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { EntitlementService } from './entitlement.service';
import {
  type AlertRuleType,
  UNIMPLEMENTED_RULE_TYPES,
  isEvaluatedRuleType,
} from './alert-triggers';

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
    const res = await query<any>(
      `SELECT r.*, o.title as opportunity_title, o.slug as opportunity_slug,
              c.verdict as current_verdict
       FROM alert_rules r
       JOIN opportunities o ON o.id = r.opportunity_id
       LEFT JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
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
     * 判据是 `isEvaluatedRuleType`（`alert-triggers.ts` 的 EVALUATED_RULE_TYPES），
     * 与每日流水线用的是**同一个**集合。Phase 2 的 NEW_AUTHORITATIVE_ENTRANT 在这里
     * 被拒；`CROWDING_SIGNAL` 已有生产者与游标，可以订阅。静默失效比明确的
     * "暂不支持"更糟：用户会以为自己被盯着。
     */
    if (!isEvaluatedRuleType(input.ruleType)) {
      throw new EmeradarError(
        ErrorCode.VALIDATION_ERROR,
        UNIMPLEMENTED_RULE_TYPES[input.ruleType] ??
          `Unsupported alert rule type: ${input.ruleType}`,
        400
      );
    }

    const opportunityRes = await query<{ id: string }>(
      `SELECT o.id
       FROM opportunities o
       JOIN opportunity_cards c ON c.opportunity_id = o.id
       WHERE o.id = $1 AND o.status = 'TRACKED'`,
      [input.opportunityId]
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

    const res = await query<any>(
      `SELECT n.*, o.slug as opportunity_slug, o.title as opportunity_title
       FROM notifications n
       LEFT JOIN opportunities o ON o.id = n.opportunity_id
       WHERE ${where}
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [userId]
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
