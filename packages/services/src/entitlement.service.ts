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
  feedDelayDays: number;
  opportunityDetailFull: boolean;
  deepReportExport: boolean;
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
    const opportunityDetailFull = row.plan_code !== 'FREE';
    const deepReportExport = row.plan_code !== 'FREE';
    const realtime = row.plan_code === 'PRO' || row.plan_code === 'TEAM';
    const feedDelayDays =
      typeof ent.feed_delay_days === 'number' ? ent.feed_delay_days : realtime ? 0 : 45;

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
      feedDelayDays,
      opportunityDetailFull,
      deepReportExport,
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
      const entRes = await client.query<{ plan_code: string; entitlements: any }>(
        `SELECT COALESCE(s.plan_code, 'FREE') AS plan_code, p.entitlements
         FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status IN ('ACTIVE','TRIALING')
         LEFT JOIN plans p ON p.code = COALESCE(s.plan_code, 'FREE') WHERE u.id = $1 AND u.status = 'ACTIVE'`, [userId]);
      if (entRes.rows.length === 0) throw new EmeradarError(ErrorCode.UNAUTHORIZED, 'User not found', 404);
      const ent = entRes.rows[0];
      const exportLimit = ent.entitlements?.export_reports_monthly ?? 1;

      if (exportLimit === -1) {
        // Unlimited tier (Pro / Team)
        return {
          reservationToken: `unlimited_${Date.now()}`,
          isUnlimited: true,
        };
      }

      const periodStart = new Date();
      periodStart.setDate(1);
      const period = periodStart.toISOString().slice(0, 10);
      const counter = await client.query<{ used: number }>(
        `INSERT INTO usage_counters (user_id, feature, period_start, used)
         VALUES ($1, 'EXPORT_REPORT', $2, 1)
         ON CONFLICT (user_id, feature, period_start) DO UPDATE
         SET used = usage_counters.used + 1
         WHERE usage_counters.used < $3
         RETURNING used`, [userId, period, exportLimit]);
      if (counter.rows.length === 0) {
        throw new EmeradarError(
          ErrorCode.QUOTA_EXCEEDED,
          `You have reached your monthly report export limit (${exportLimit}). Please upgrade to Builder Pro for 30 exports/month.`,
          429,
          {
            upgradeUrl: '/billing',
            currentPlan: ent.plan_code,
            limit: exportLimit,
          }
        );
      }

      const reservationToken = `res_${userId}_${opportunityId}_${Date.now()}`;
      return { reservationToken: `${reservationToken}:${period}`, isUnlimited: false };
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

    const periodStart = reservationToken.split(':').pop();
    if (!periodStart || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return;

    await query(
      `UPDATE usage_counters
       SET used = GREATEST(0, used - 1)
       WHERE user_id = $1 AND feature = 'EXPORT_REPORT' AND period_start = $2;`,
      [userId, periodStart]
    );
  }
}
