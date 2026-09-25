import { query, transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';

export interface UserEntitlementsInfo {
  userId: string;
  tier: string;
  planCode: string;
  exportReportsMonthlyLimit: number;
  exportReportsUsed: number;
  remainingReports: number;
  maxProjects: number;
  currentProjectsCount: number;
  maxAlerts: number;
  currentAlertsCount: number;
  apiAccess: boolean;
}

export class EntitlementService {
  /**
   * Get user's current plan and remaining entitlements
   */
  static async getUserEntitlements(userId: string): Promise<UserEntitlementsInfo> {
    const userRes = await query<{
      id: string;
      tier: string;
      plan_code: string;
      entitlements: any;
    }>(
      `SELECT u.id, u.tier, COALESCE(s.plan_code, 'FREE') as plan_code, p.entitlements
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'ACTIVE'
       LEFT JOIN plans p ON p.code = COALESCE(s.plan_code, 'FREE')
       WHERE u.id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.UNAUTHORIZED,
        `User ${userId} not found`,
        404
      );
    }

    const row = userRes.rows[0];
    const ent = row.entitlements || {};
    const exportLimit = ent.export_reports_monthly ?? 1;
    const maxProjects = ent.max_projects ?? 1;
    const maxAlerts = ent.max_alerts ?? 0;
    const apiAccess = !!ent.api_access;

    // Check usage in current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const dateStr = startOfMonth.toISOString().slice(0, 10);

    const counterRes = await query<{ used: number }>(
      `SELECT used FROM usage_counters 
       WHERE user_id = $1 AND feature = 'EXPORT_REPORT' AND period_start = $2`,
      [userId, dateStr]
    );
    const used = counterRes.rows[0]?.used ?? 0;

    // Count projects
    const projRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM projects WHERE user_id = $1`,
      [userId]
    );
    const projCount = parseInt(projRes.rows[0]?.count ?? '0', 10);

    // Count alert rules
    const alertRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM alert_rules WHERE user_id = $1`,
      [userId]
    );
    const alertCount = parseInt(alertRes.rows[0]?.count ?? '0', 10);

    const remaining = exportLimit === -1 ? 999999 : Math.max(0, exportLimit - used);

    return {
      userId,
      tier: row.tier,
      planCode: row.plan_code,
      exportReportsMonthlyLimit: exportLimit,
      exportReportsUsed: used,
      remainingReports: remaining,
      maxProjects,
      currentProjectsCount: projCount,
      maxAlerts,
      currentAlertsCount: alertCount,
      apiAccess,
    };
  }

  /**
   * Hold & Release: Reserve export quota before generating report
   */
  static async reserveExportQuota(
    userId: string,
    opportunityId: string
  ): Promise<{ reservationToken: string; isUnlimited: boolean }> {
    return transaction(async (client) => {
      const ent = await this.getUserEntitlements(userId);

      if (ent.exportReportsMonthlyLimit === -1) {
        // Unlimited tier (Pro / Team)
        return {
          reservationToken: `unlimited_${Date.now()}`,
          isUnlimited: true,
        };
      }

      if (ent.remainingReports <= 0) {
        throw new EmeradarError(
          ErrorCode.QUOTA_EXCEEDED,
          `You have reached your monthly report export limit (${ent.exportReportsMonthlyLimit}). Please upgrade to Builder Pro for 30 exports/month.`,
          429,
          {
            upgradeUrl: '/billing',
            currentPlan: ent.planCode,
            limit: ent.exportReportsMonthlyLimit,
          }
        );
      }

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      const periodStart = startOfMonth.toISOString().slice(0, 10);

      // Increment usage counter atomically
      await client.query(
        `INSERT INTO usage_counters (user_id, feature, period_start, used)
         VALUES ($1, 'EXPORT_REPORT', $2, 1)
         ON CONFLICT (user_id, feature, period_start)
         DO UPDATE SET used = usage_counters.used + 1;`,
        [userId, periodStart]
      );

      const reservationToken = `res_${userId}_${opportunityId}_${Date.now()}`;
      return { reservationToken, isUnlimited: false };
    });
  }

  /**
   * Hold & Release: Confirm quota usage upon successful generation
   */
  static async confirmExportQuota(
    userId: string,
    reservationToken: string,
    reportId: string
  ): Promise<void> {
    if (reservationToken.startsWith('unlimited_')) {
      return;
    }

    await query(
      `INSERT INTO usage_events (id, user_id, feature, units, channel, request_id)
       VALUES ($1, $2, 'EXPORT_REPORT', 1, 'WEB', $3)
       ON CONFLICT (user_id, feature, request_id) DO NOTHING;`,
      [`evt_${Date.now()}`, userId, reportId]
    );
  }

  /**
   * Hold & Release: Release reserved quota if report generation failed
   */
  static async releaseExportQuota(
    userId: string,
    reservationToken: string
  ): Promise<void> {
    if (reservationToken.startsWith('unlimited_')) {
      return;
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const periodStart = startOfMonth.toISOString().slice(0, 10);

    await query(
      `UPDATE usage_counters
       SET used = GREATEST(0, used - 1)
       WHERE user_id = $1 AND feature = 'EXPORT_REPORT' AND period_start = $2;`,
      [userId, periodStart]
    );
  }
}
