import { query } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { EntitlementService } from './entitlement.service';

export type AlertRuleType =
  | 'VERDICT_CHANGE'
  | 'WINDOW_CLOSING'
  | 'NEW_ENTRANT'
  | 'KILL_CRITERIA';

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

    const ent = await EntitlementService.getUserEntitlements(userId);
    if (ent.currentAlertsCount >= ent.maxAlerts) {
      throw new EmeradarError(
        ErrorCode.QUOTA_EXCEEDED,
        `Your plan allows up to ${ent.maxAlerts} active alerts. Upgrade to Builder Pro for 20 active alerts.`,
        403,
        { currentAlerts: ent.currentAlertsCount, maxAlerts: ent.maxAlerts }
      );
    }

    const ruleId = `alr_${Date.now()}`;
    const res = await query<any>(
      `INSERT INTO alert_rules (id, user_id, opportunity_id, rule_type, frequency, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [
        ruleId,
        userId,
        input.opportunityId,
        input.ruleType,
        input.frequency || 'IMMEDIATE',
      ]
    );

    return res.rows[0];
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
