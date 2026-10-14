import { query, transaction } from '@emeradar/db';
import type { PoolClient } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';

export interface UserEntitlementsInfo {
  userId: string;
  tier: string;
  planCode: string;
  exportReportsMonthlyLimit: number;
  exportReportsUsed: number;
  remainingReports: number;
  reportGenerationMonthlyLimit: number;
  reportGenerationUsed: number;
  remainingReportGenerations: number;
  maxProjects: number;
  currentProjectsCount: number;
  maxAlerts: number;
  currentAlertsCount: number;
  apiAccess: boolean;
  feedDelayDays: number;
  opportunityDetailFull: boolean;
  deepReportExport: boolean;
  liveScanDailyLimit: number;
  liveScansUsedToday: number;
  remainingLiveScansToday: number;
  /**
   * When the paid period next renews, or `null` when nothing is billed.
   *
   * Null covers the free plan, an expired subscription, and one that is PAST_DUE:
   * in the last case the period end is in the past and nothing is scheduled until
   * payment lands, so reporting the old date would have the settings page promise
   * a renewal that no payment backs. The page needs the distinction between "no
   * billing" and "billing, here is the date".
   */
  renewsAt: string | null;
}

export class EntitlementService {
  /**
   * The one way to resolve a user's plan, shared by every quota read here.
   *
   * `subscriptions` is the **only** source of truth for entitlements. `users.tier`
   * is a display mirror and is deliberately not consulted: while it was a fallback
   * here, the mirror was written by one path (`activateSubscription`) and the
   * subscription row by another (`updateSubscriptionState`), so the two could
   * disagree indefinitely — a cancelled subscription kept PRO entitlements
   * because `tier` still said PRO. A mirror that can grant entitlements is not a
   * mirror; it is a second source of truth, and the two will always diverge.
   *
   * Expiry is enforced **here, in the join**, rather than by a sweeper job:
   *
   *   - fail-closed means an expired row grants nothing even if no webhook ever
   *     arrives and no cron ever runs. Put the check in application code instead
   *     and every call site has to remember it; the one that forgets leaks
   *     unlimited entitlements.
   *   - `PAST_DUE` keeps its plan for a 7-day grace window measured from
   *     `past_due_since`, then falls to FREE on its own. The window's end is a
   *     property of the data, so no job has to run for it to take effect.
   *   - `current_period_end` is "paid through", never a dunning timer; see the
   *     column notes in packages/db/src/schema.sql.
   *
   * Keep this predicate in step with the tier-normalization statement in
   * schema.sql, which derives `users.tier` from the same conditions.
   *
   * Exported (not private) so the profile projections in `auth.service` resolve the
   * plan with **this** join rather than writing a fifth copy of the predicate. The
   * whole point of collapsing them was that a second copy is a second answer.
   * It expects the users table aliased as `u`, and the subscription alias is a
   * parameter because two call sites already bind `s` to `sessions`. The alias is a
   * parameter rather than something call sites rewrite with a string replace: a
   * query that has been rewritten at the call site cannot be read.
   */
  static entitlementPlanJoin(subscriptionAlias = 's', planAlias = 'p'): string {
    const a = subscriptionAlias;
    const p = planAlias;
    return `LEFT JOIN LATERAL (
         SELECT ${a}.plan_code, ${a}.status, ${a}.current_period_start, ${a}.current_period_end, ${a}.entitlements_snapshot
         FROM subscriptions ${a}
         WHERE ${a}.user_id = u.id
           AND (
             (${a}.status IN ('ACTIVE','TRIALING') AND ${a}.current_period_end > NOW())
             OR (${a}.status = 'PAST_DUE' AND ${a}.past_due_since > NOW() - INTERVAL '7 days')
           )
         LIMIT 1
       ) ${a} ON true
       LEFT JOIN plans ${p} ON ${p}.code = COALESCE(${a}.plan_code, 'FREE')`;
  }

  /**
   * The effective entitlement bag: the plan catalog, with this subscription's
   * snapshot layered on top.
   *
   * Snapshot-over-catalog rather than `COALESCE(snapshot, catalog)` because a
   * snapshot is not always whole. The rows written before this rework carry a
   * single key (`export_reports_monthly`), and `COALESCE` treats any non-empty
   * object as authoritative — so those subscriptions resolved `max_projects` to
   * `NULL` and fell through to `?? 1`: a paying customer capped at one project.
   * Layering keeps docs/13 §3.3 intact (a key the snapshot defines is frozen for
   * the period) without letting an incomplete snapshot shadow the catalog.
   */
  private static effectiveEntitlements(subscriptionAlias = 's', planAlias = 'p'): string {
    return `(COALESCE(${planAlias}.entitlements, '{}'::jsonb)
             || COALESCE(NULLIF(${subscriptionAlias}.entitlements_snapshot, '{}'::jsonb), '{}'::jsonb))`;
  }

  /**
   * The current quota window start for a monthly quota, anchored on the billing
   * period so a quota resets when the customer is billed — not on the 1st of the
   * month, which hands someone billed on the 20th a fresh allowance eleven days
   * early and takes one away from someone billed on the 25th.
   *
   * Anchoring must **roll forward**: using the subscription's period start
   * verbatim would freeze the counter key forever, and `usage_counters.used`
   * would only ever grow.
   *
   * Month ends are clamped (Jan 31 → Feb 28) so a subscription started on the
   * 31st keeps a valid period in February.
   */
  static quotaPeriodStart(anchor: Date, today: Date): string {
    const anchorDay = anchor.getUTCDate();
    let months =
      (today.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (today.getUTCMonth() - anchor.getUTCMonth());
    if (today.getUTCDate() < anchorDay) months -= 1;
    if (months < 0) months = 0;

    const rolled = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1));
    const daysInMonth = new Date(Date.UTC(rolled.getUTCFullYear(), rolled.getUTCMonth() + 1, 0)).getUTCDate();
    rolled.setUTCDate(Math.min(anchorDay, daysInMonth));
    return rolled.toISOString().slice(0, 10);
  }

  /**
   * The quota window for a resolved row. Both the display path and the reserve*
   * paths must call this: they write and read the same `usage_counters` key, so a
   * disagreement is not a rounding difference — it is "you have 30 exports left"
   * followed immediately by a 429.
   */
  private static periodFor(row: {
    subscription_period_start?: Date | string | null;
    created_at?: Date | string | null;
  }): string {
    const anchor = row.subscription_period_start ?? row.created_at ?? null;
    if (anchor) return EntitlementService.quotaPeriodStart(new Date(anchor), new Date());
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    return startOfMonth.toISOString().slice(0, 10);
  }

  /**
   * Get user's current plan and remaining entitlements
   */
  static async getUserEntitlements(userId: string): Promise<UserEntitlementsInfo> {
    const userRes = await query<{
      id: string;
      role: string;
      status: string;
      tier: string;
      plan_code: string;
      subscription_status: string | null;
      current_period_end: Date | null;
      subscription_period_start: Date | null;
      created_at: Date | null;
      entitlements: any;
    }>(
      // Every quota read in this service resolves the plan the same way; see
      // `entitlementPlanJoin` for why the join and the COALESCE must not drift.
      `SELECT u.id, u.role, u.status, u.tier, u.created_at,
              COALESCE(s.plan_code, 'FREE') as plan_code,
              s.status AS subscription_status,
              s.current_period_end, s.current_period_start AS subscription_period_start,
              ${EntitlementService.effectiveEntitlements()} AS entitlements
       FROM users u
       ${EntitlementService.entitlementPlanJoin()}
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
    // A suspended or deleted account keeps no paid entitlements, even if its
    // subscription row is still marked ACTIVE (e.g. mid-dispute or mid-refund).
    const accountActive = row.status === 'ACTIVE';
    const isAdmin = row.role === 'ADMIN' && accountActive;
    const ent = accountActive ? (row.entitlements || {}) : {};
    const planCode = accountActive ? row.plan_code : 'FREE';
    const exportLimit = isAdmin ? -1 : (ent.export_reports_monthly ?? 1);
    const reportGenerationLimit = isAdmin ? -1 : (ent.generate_reports_monthly ?? ent.export_reports_monthly ?? 1);
    const maxProjects = isAdmin ? 9999 : (ent.max_projects ?? 1);
    const maxAlerts = isAdmin ? 9999 : (ent.max_alerts ?? 0);
    const apiAccess = isAdmin || !!ent.api_access;
    const opportunityDetailFull = isAdmin || planCode !== 'FREE';
    const deepReportExport = isAdmin || planCode !== 'FREE';
    const feedDelayDays = isAdmin
      ? 0
      : typeof ent.feed_delay_days === 'number'
      ? ent.feed_delay_days
      : 0;

    // Quota window = the billing period (docs/13 §4.2), not the calendar month.
    // A subscription anchors it on its own period start; everyone else (the free
    // plan) anchors on account creation, so "1 report / month" means a month
    // since you signed up rather than a shared 1st-of-the-month reset.
    const dateStr = EntitlementService.periodFor(row);

    const counterRes = await query<{ used: number }>(
      `SELECT used FROM usage_counters 
       WHERE user_id = $1 AND feature = 'EXPORT_REPORT' AND period_start = $2`,
      [userId, dateStr]
    );
    const used = counterRes.rows[0]?.used ?? 0;

    const generationCounterRes = await query<{ used: number }>(
      `SELECT used FROM usage_counters
       WHERE user_id = $1 AND feature = 'GENERATE_REPORT' AND period_start = $2`,
      [userId, dateStr]
    );
    const generationUsed = generationCounterRes.rows[0]?.used ?? 0;

    // Daily live scan quota, read from the catalog. It used to be hardcoded here
    // and again in reserveLiveScanQuota as a planCode ladder, so a plan whose
    // catalog said 50 scans reported 30 and enforced 30 — three places to keep in
    // step, and the catalog's own `live_scan_daily` key was never read at all.
    const today = new Date().toISOString().slice(0, 10);
    const scanLimit = isAdmin ? 9999 : (ent.live_scan_daily ?? 3);
    const scanCounterRes = await query<{ used: number }>(
      `SELECT used FROM usage_counters
       WHERE user_id = $1 AND feature = 'LIVE_SCAN' AND period_start = $2`,
      [userId, today]
    );
    const scansUsedToday = scanCounterRes.rows[0]?.used ?? 0;
    const remainingScansToday = Math.max(0, scanLimit - scansUsedToday);

    // Count projects
    const projRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM projects WHERE user_id = $1`,
      [userId]
    );
    const projCount = parseInt(projRes.rows[0]?.count ?? '0', 10);

    // Count alert rules. Only *active* ones consume the allowance — the create
    // path (alert.service.ts) and the delivery path both count `is_active = true`,
    // and this read used to count every row including disabled ones. So a user who
    // hit their limit, disabled a rule and tried to add another was told they were
    // at 20/20 with 19 active, and the UI and the API disagreed about the same
    // number.
    const alertRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM alert_rules WHERE user_id = $1 AND is_active = true`,
      [userId]
    );
    const alertCount = parseInt(alertRes.rows[0]?.count ?? '0', 10);

    const remaining = exportLimit === -1 ? 999999 : Math.max(0, exportLimit - used);
    const remainingGenerations = reportGenerationLimit === -1 ? 999999 : Math.max(0, reportGenerationLimit - generationUsed);

    return {
      userId,
      tier: accountActive ? row.tier : 'FREE',
      planCode,
      exportReportsMonthlyLimit: exportLimit,
      exportReportsUsed: used,
      remainingReports: remaining,
      reportGenerationMonthlyLimit: reportGenerationLimit,
      reportGenerationUsed: generationUsed,
      remainingReportGenerations: remainingGenerations,
      maxProjects,
      currentProjectsCount: projCount,
      maxAlerts,
      currentAlertsCount: alertCount,
      apiAccess,
      feedDelayDays,
      opportunityDetailFull,
      deepReportExport,
      liveScanDailyLimit: scanLimit,
      liveScansUsedToday: scansUsedToday,
      remainingLiveScansToday: remainingScansToday,
      // Only a subscription that is actively paid bills. A PAST_DUE one in its
      // grace window is entitled but has nothing scheduled: its period end is
      // already behind us, so echoing it would advertise a renewal date in the
      // past.
      renewsAt:
        accountActive && row.subscription_status && row.subscription_status !== 'PAST_DUE' && row.current_period_end
          ? row.current_period_end.toISOString()
          : null,
    };
  }

  /**
   * 预占一次原子立项导出（`atomic_go_export_monthly`，13 §3.2、13 §4.3）。
   *
   * **必须在调用方的事务里执行**，与占槽、建 Project 同一事务：配额与槽位若各自
   * 提交，"扣了额度但没占到槽"和"占到槽但没扣额度"就都成了可观测状态，而第二种
   * 就是白拿点火包的入口（13 §4.3）。
   *
   * 与报告的 `reserveExportQuota` 是两个不同的额：复用同一个键会让"锁槽一次"和
   * "导出一次"分叉成两个可分别绕过的闸门。
   */
  static async reserveAtomicGoQuota(
    client: PoolClient,
    userId: string
  ): Promise<{ periodStart: string; limit: number; carryover: number }> {
    const res = await client.query<{
      role: string;
      entitlements: any;
      subscription_period_start: Date | null;
      created_at: Date | null;
    }>(
      `SELECT u.role, u.created_at,
              ${EntitlementService.effectiveEntitlements()} AS entitlements,
              s.current_period_start AS subscription_period_start
         FROM users u
         ${EntitlementService.entitlementPlanJoin()}
        WHERE u.id = $1 AND u.status = 'ACTIVE'`,
      [userId]
    );
    const row = res.rows[0];
    if (!row) throw new EmeradarError(ErrorCode.UNAUTHORIZED, 'User not found', 404);

    if (row.role === 'ADMIN') {
      return { periodStart: EntitlementService.periodFor(row), limit: -1, carryover: 0 };
    }

    const ent = row.entitlements || {};
    // 缺键按 0 处理（失败关闭）：读不到额度就不给额度。免费层因此得到的是
    // PLAN_REQUIRED 而不是一个靠 ?? 兜出来的数字。
    const base = typeof ent.atomic_go_export_monthly === 'number' ? ent.atomic_go_export_monthly : 0;
    if (base <= 0) {
      throw new EmeradarError(
        ErrorCode.PLAN_REQUIRED,
        'Atomic GO (claiming a build slot and unlocking its launch kit) requires Builder Pro.',
        403,
        { upgradeUrl: '/pricing', currentPlan: 'FREE' }
      );
    }

    const period = EntitlementService.periodFor(row);
    const carryover = await EntitlementService.settleAndReadCarryover(client, userId, row, period, base);
    const effective = base + carryover;

    const counter = await client.query<{ used: number }>(
      `INSERT INTO usage_counters (user_id, feature, period_start, used)
       VALUES ($1, 'atomic_go_export_monthly', $2, 1)
       ON CONFLICT (user_id, feature, period_start) DO UPDATE
       SET used = usage_counters.used + 1
       WHERE usage_counters.used < $3
       RETURNING used`,
      [userId, period, effective]
    );
    if (counter.rows.length === 0) {
      throw new EmeradarError(
        ErrorCode.QUOTA_EXCEEDED,
        `Monthly atomic GO quota reached (${effective}). It resets with your next billing period.`,
        403,
        { upgradeUrl: '/pricing', currentPlan: 'PRO', details: { limit: effective } }
      );
    }
    return { periodStart: period, limit: effective, carryover };
  }

  /**
   * 跨月累计（13 §4.2，`"rollover": true`）。只结转**一期**：上一期的剩余额度
   * 成为本期的额外可用量，再上一期的作废。
   *
   * 只结转一期的判据是"只读 `from_period_start` 恰好等于上一期的那几行"，而不是
   * 在读取时把旧行标记为已消费——标记会在本期中途把额度抽走，而同一个月里前一次
   * 预占和后一次预占必须看到同一个上限。
   *
   * 结算写在这里（而不是一个独立作业）的原因：结转只在"有人真的要用额度"时才有
   * 意义，而那正是第一次预占的时刻。少一个必须按时跑到的作业，就少一处会静默
   * 漏掉结转的地方。
   */
  private static async settleAndReadCarryover(
    client: PoolClient,
    userId: string,
    row: { subscription_period_start?: Date | string | null; created_at?: Date | string | null },
    period: string,
    base: number
  ): Promise<number> {
    const anchor = row.subscription_period_start ?? row.created_at ?? null;
    if (!anchor) return 0;
    // 上一期的起点 = 从本期起点往前退一天，再按锚点日对齐。
    const dayBefore = new Date(`${period}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const previous = EntitlementService.quotaPeriodStart(new Date(anchor), dayBefore);
    if (previous >= period) return 0;

    const priorUsed = await client.query<{ used: number }>(
      `SELECT used FROM usage_counters
        WHERE user_id = $1 AND feature = 'atomic_go_export_monthly' AND period_start = $2`,
      [userId, previous]
    );
    const usedInPrevious = priorUsed.rows[0]?.used ?? 0;
    const leftover = Math.max(0, base - usedInPrevious);
    if (leftover > 0) {
      // `units > 0` 是 CHECK 约束，所以零剩余不留行 —— 一行 "0 结转" 只会让
      // "这个月为什么是 5 次"多出一条需要解释的记录。
      await client.query(
        `INSERT INTO usage_carryovers (user_id, feature, from_period_start, units)
         VALUES ($1, 'atomic_go_export_monthly', $2, $3)
         ON CONFLICT (user_id, feature, from_period_start) DO NOTHING`,
        [userId, previous, leftover]
      );
    }

    const carried = await client.query<{ total: string | null }>(
      `SELECT SUM(units)::text AS total FROM usage_carryovers
        WHERE user_id = $1 AND feature = 'atomic_go_export_monthly'
          AND from_period_start = $2 AND consumed_in_period IS NULL`,
      [userId, previous]
    );
    return Number.parseInt(carried.rows[0]?.total ?? '0', 10) || 0;
  }

  /** Reserve a report generation slot. Generation and file export are separate entitlements. */
  static async reserveReportGenerationQuota(
    userId: string,
    opportunityId: string
  ): Promise<{ reservationToken: string; isUnlimited: boolean }> {
    return transaction(async (client) => {
      const entRes = await client.query<{
        role: string;
        plan_code: string;
        entitlements: any;
        subscription_period_start: Date | null;
        created_at: Date | null;
      }>(
        `SELECT u.role, u.created_at, COALESCE(s.plan_code, 'FREE') AS plan_code,
                s.current_period_start AS subscription_period_start,
                ${EntitlementService.effectiveEntitlements()} AS entitlements
         FROM users u
         ${EntitlementService.entitlementPlanJoin()}
         WHERE u.id = $1 AND u.status = 'ACTIVE'`,
        [userId]
      );
      if (entRes.rows.length === 0) throw new EmeradarError(ErrorCode.UNAUTHORIZED, 'User not found', 404);
      const ent = entRes.rows[0];
      const limit = ent.role === 'ADMIN' ? -1 : (ent.entitlements?.generate_reports_monthly ?? ent.entitlements?.export_reports_monthly ?? 1);
      if (limit === -1) return { reservationToken: `unlimited_generate_${Date.now()}`, isUnlimited: true };

      const period = EntitlementService.periodFor(ent);
      const counter = await client.query<{ used: number }>(
        `INSERT INTO usage_counters (user_id, feature, period_start, used)
         VALUES ($1, 'GENERATE_REPORT', $2, 1)
         ON CONFLICT (user_id, feature, period_start) DO UPDATE
         SET used = usage_counters.used + 1
         WHERE usage_counters.used < $3
         RETURNING used`,
        [userId, period, limit]
      );
      if (counter.rows.length === 0) {
        throw new EmeradarError(
          ErrorCode.QUOTA_EXCEEDED,
          `You have reached your monthly report generation limit (${limit}). Please upgrade your plan.`,
          429,
          { upgradeUrl: '/pricing', currentPlan: ent.plan_code, limit }
        );
      }
      return {
        reservationToken: `gen_${userId}_${opportunityId}_${Date.now()}:${period}`,
        isUnlimited: false,
      };
    });
  }

  static async confirmReportGenerationQuota(userId: string, reservationToken: string, reportId: string): Promise<void> {
    if (reservationToken.startsWith('unlimited_generate_')) return;
    await query(
      `INSERT INTO usage_events (id, user_id, feature, units, channel, request_id)
       VALUES ($1, $2, 'GENERATE_REPORT', 1, 'WEB', $3)
       ON CONFLICT (user_id, feature, request_id) DO NOTHING`,
      [`evt_${Date.now()}`, userId, reportId]
    );
  }

  static async releaseReportGenerationQuota(userId: string, reservationToken: string): Promise<void> {
    if (reservationToken.startsWith('unlimited_generate_')) return;
    const periodStart = reservationToken.split(':').pop();
    if (!periodStart || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return;
    await query(
      `UPDATE usage_counters
       SET used = GREATEST(0, used - 1)
       WHERE user_id = $1 AND feature = 'GENERATE_REPORT' AND period_start = $2`,
      [userId, periodStart]
    );
  }

  /**
   * Hold & Release: Reserve export quota before generating report
   */
  static async reserveExportQuota(
    userId: string,
    opportunityId: string
  ): Promise<{ reservationToken: string; isUnlimited: boolean }> {
    return transaction(async (client) => {
      const entRes = await client.query<{
        role: string;
        plan_code: string;
        entitlements: any;
        subscription_period_start: Date | null;
        created_at: Date | null;
      }>(
        `SELECT u.role, u.created_at, COALESCE(s.plan_code, 'FREE') AS plan_code,
                s.current_period_start AS subscription_period_start,
                ${EntitlementService.effectiveEntitlements()} AS entitlements
         FROM users u
         ${EntitlementService.entitlementPlanJoin()}
         WHERE u.id = $1 AND u.status = 'ACTIVE'`, [userId]);
      if (entRes.rows.length === 0) throw new EmeradarError(ErrorCode.UNAUTHORIZED, 'User not found', 404);
      const ent = entRes.rows[0];
      const exportLimit = ent.role === 'ADMIN' ? -1 : (ent.entitlements?.export_reports_monthly ?? 1);

      if (exportLimit === -1) {
        // Unlimited tier (Admin / Pro / Team)
        return {
          reservationToken: `unlimited_${Date.now()}`,
          isUnlimited: true,
        };
      }

      const period = EntitlementService.periodFor(ent);
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

  /**
   * Hold & Check: Reserve daily live scan quota
   * Free: 3/day, Pro: 30/day, Team: 100/day
   */
  static async reserveLiveScanQuota(userId: string): Promise<{ remaining: number; limit: number; used: number }> {
    return transaction(async (client) => {
      const userRes = await client.query<{ role: string; plan_code: string; entitlements: any }>(
        `SELECT u.role, COALESCE(s.plan_code, 'FREE') AS plan_code,
                ${EntitlementService.effectiveEntitlements()} AS entitlements
         FROM users u
         ${EntitlementService.entitlementPlanJoin()}
         WHERE u.id = $1 AND u.status = 'ACTIVE'`,
        [userId]
      );

      if (userRes.rows.length === 0) {
        throw new EmeradarError(ErrorCode.UNAUTHORIZED, 'User not found', 404);
      }

      const isAdmin = userRes.rows[0].role === 'ADMIN';
      const planCode = userRes.rows[0].plan_code;
      // Same source as the display path (getUserEntitlements). The planCode ladder
      // that used to live here is exactly how the UI and the enforcement could name
      // different numbers for the same account.
      const limit = isAdmin ? 9999 : (userRes.rows[0].entitlements?.live_scan_daily ?? 3);
      const today = new Date().toISOString().slice(0, 10);

      const counter = await client.query<{ used: number }>(
        `INSERT INTO usage_counters (user_id, feature, period_start, used)
         VALUES ($1, 'LIVE_SCAN', $2, 1)
         ON CONFLICT (user_id, feature, period_start) DO UPDATE
         SET used = usage_counters.used + 1
         WHERE usage_counters.used < $3
         RETURNING used`,
        [userId, today, limit]
      );

      if (counter.rows.length === 0) {
        throw new EmeradarError(
          ErrorCode.QUOTA_EXCEEDED,
          planCode === 'FREE'
            ? `Daily live scan quota reached (${limit} scans/day). Upgrade to Builder Pro for more.`
            : `Daily live scan quota reached (${limit} scans/day).`,
          429,
          {
            upgradeUrl: '/pricing',
            currentPlan: planCode,
            limit,
          }
        );
      }

      const used = counter.rows[0].used;
      return { remaining: Math.max(0, limit - used), limit, used };
    });
  }
}
