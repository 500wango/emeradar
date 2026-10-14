import { query, transaction } from '@emeradar/db';
import { AppError } from '@emeradar/core';
import { randomBytes } from 'node:crypto';
import { AuthService } from '../auth.service';
import { AuditService } from '../audit.service';
import { EntitlementService } from '../entitlement.service';
import { SubscriptionLifecycleService, readPlanEntitlements, NO_EXPIRY } from '../subscription-lifecycle.service';
import type { AdminUserListItem, AdminUserStats } from './types';

export class AdminUserService {
  /**
   * Retrieves high-level user statistics
   */
  static async getUserStats(): Promise<AdminUserStats> {
    const res = await query<{
      total_users: string;
      active_users: string;
      paid_users: string;
      staff_users: string;
    }>(`
      SELECT
        COUNT(*)::text AS total_users,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END)::text AS active_users,
        COUNT(CASE WHEN tier IN ('PRO', 'TEAM') THEN 1 END)::text AS paid_users,
        COUNT(CASE WHEN role IN ('ADMIN', 'ANALYST') THEN 1 END)::text AS staff_users
      FROM users
    `);
    const r = res.rows[0];
    return {
      totalUsers: parseInt(r?.total_users || '0', 10),
      activeUsers: parseInt(r?.active_users || '0', 10),
      paidUsers: parseInt(r?.paid_users || '0', 10),
      staffUsers: parseInt(r?.staff_users || '0', 10),
    };
  }

  /**
   * Lists users with search, role, tier, and status filtering with pagination
   */
  static async listUsers(options?: {
    userId?: string;
    search?: string;
    role?: string;
    tier?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AdminUserListItem[]; total: number; stats: AdminUserStats }> {
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = Math.max(0, options?.offset || 0);
    const search = options?.search?.trim();

    const conditions: string[] = [];
    const params: any[] = [];

    if (options?.userId) {
      params.push(options.userId);
      conditions.push(`u.id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(
        `(LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.display_name, '')) LIKE $${params.length} OR LOWER(u.id) LIKE $${params.length})`
      );
    }

    if (options?.role && ['USER', 'ANALYST', 'ADMIN', 'SUPPORT'].includes(options.role)) {
      params.push(options.role);
      conditions.push(`u.role = $${params.length}`);
    }

    if (options?.tier && ['FREE', 'PRO', 'TEAM'].includes(options.tier)) {
      params.push(options.tier);
      conditions.push(`u.tier = $${params.length}`);
    }

    if (options?.status && ['ACTIVE', 'SUSPENDED', 'DELETED'].includes(options.status)) {
      params.push(options.status);
      conditions.push(`u.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users u ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listParams = [...params, limit, offset];
    const itemsRes = await query<{
      id: string;
      email: string;
      display_name: string | null;
      avatar_url: string | null;
      role: 'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT';
      tier: 'FREE' | 'PRO' | 'TEAM';
      status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
      created_at: string;
      updated_at: string;
      projects_count: number;
      alerts_count: number;
      api_keys_count: number;
      // `COALESCE(s.plan_code, 'FREE')` in the projection, so non-null.
      subscription_plan_code: string;
      has_active_subscription: boolean;
    }>(
      `SELECT
        u.id,
        u.email,
        u.display_name,
        u.avatar_url,
        u.role,
        u.tier,
        u.status,
        u.created_at::text,
        u.updated_at::text,
        COALESCE(p.cnt, 0)::int AS projects_count,
        COALESCE(a.cnt, 0)::int AS alerts_count,
        COALESCE(k.cnt, 0)::int AS api_keys_count,
        COALESCE(s.plan_code, 'FREE') AS subscription_plan_code,
        (s.plan_code IS NOT NULL) AS has_active_subscription
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS cnt FROM projects GROUP BY user_id
      ) p ON p.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS cnt FROM alert_rules GROUP BY user_id
      ) a ON a.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS cnt FROM api_keys WHERE revoked_at IS NULL GROUP BY user_id
      ) k ON k.user_id = u.id
      ${EntitlementService.entitlementPlanJoin('s', 'pl')}
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const stats = await this.getUserStats();

    return {
      total,
      stats,
      items: itemsRes.rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        role: r.role,
        tier: r.tier,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        projectsCount: r.projects_count,
        alertsCount: r.alerts_count,
        apiKeysCount: r.api_keys_count,
        subscriptionPlanCode: r.subscription_plan_code,
        hasActiveSubscription: r.has_active_subscription,
      })),
    };
  }

  /**
   * Retrieves a single user by ID with aggregated details
   */
  static async getUserById(userId: string): Promise<AdminUserListItem | null> {
    const res = await this.listUsers({ userId, limit: 1 });
    return res.items[0] || null;
  }

  /**
   * Defense-in-depth: verify that the caller of a privileged user-management
   * operation is an ACTIVE ADMIN. Passing `null` is only permitted for the
   * one-time bootstrap of the very first administrator (i.e. when no active
   * ADMIN exists yet). ANALYST / SUPPORT / USER callers are always rejected.
   */
  private static async assertAdminCaller(callerUserId: string | null): Promise<void> {
    if (callerUserId) {
      const res = await query<{ role: string; status: string }>(
        `SELECT role, status FROM users WHERE id = $1`,
        [callerUserId]
      );
      const row = res.rows[0];
      if (!row || row.status !== 'ACTIVE' || row.role !== 'ADMIN') {
        throw AppError.forbidden('Only an active Administrator can perform this action.');
      }
      return;
    }
    // Bootstrap path: allowed only while no active ADMIN exists.
    const adminRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'`
    );
    if (parseInt(adminRes.rows[0]?.count || '0', 10) > 0) {
      throw AppError.forbidden('Administrator privileges required.');
    }
  }

  /**
   * Updates user role, tier, or status with security validations
   */
  static async updateUser(
    adminUserId: string,
    targetUserId: string,
    updates: {
      role?: 'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT';
      tier?: 'FREE' | 'PRO' | 'TEAM';
      status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
    }
  ): Promise<AdminUserListItem> {
    await this.assertAdminCaller(adminUserId);

    const curRes = await query<{
      id: string;
      email: string;
      role: string;
      tier: string;
      status: string;
    }>(`SELECT id, email, role, tier, status FROM users WHERE id = $1`, [targetUserId]);

    if (curRes.rows.length === 0) {
      throw AppError.notFound('Target user not found.');
    }
    const current = curRes.rows[0];

    // Validate Role change
    if (updates.role && updates.role !== current.role) {
      if (current.role === 'ADMIN' && updates.role !== 'ADMIN') {
        const adminCountRes = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'`
        );
        const adminCount = parseInt(adminCountRes.rows[0]?.count || '0', 10);
        if (adminCount <= 1) {
          throw AppError.badRequest('Cannot demote the only remaining active Administrator.');
        }
      }
    }

    // Validate Status change
    if (updates.status && updates.status !== current.status) {
      if (adminUserId === targetUserId && updates.status !== 'ACTIVE') {
        throw AppError.badRequest('You cannot suspend or deactivate your own account.');
      }
    }

    // Lock the user row before deciding whether to replace a Stripe-managed
    // period with a manual grant. The mirror, subscription and session revocation
    // commit together; a failed grant must never leave a visible paid tier behind.
    const tierChanged = await transaction(async (client) => {
      const locked = await client.query<{ tier: string }>(
        `SELECT tier FROM users WHERE id = $1 FOR UPDATE`, [targetUserId]
      );
      if (!locked.rows[0]) throw AppError.notFound('Target user not found.');
      const changed = Boolean(updates.tier && updates.tier !== locked.rows[0].tier);
      if (changed) {
        await SubscriptionLifecycleService.writeAdminGrant(client, targetUserId, updates.tier!);
      }
      await client.query(
        `UPDATE users SET role = COALESCE($1, role), tier = COALESCE($2, tier),
           status = COALESCE($3, status), updated_at = NOW() WHERE id = $4`,
        [updates.role ?? null, updates.tier ?? null, updates.status ?? null, targetUserId]
      );
      if (updates.status && updates.status !== 'ACTIVE') {
        await client.query(`DELETE FROM sessions WHERE user_id = $1`, [targetUserId]);
      }
      return changed;
    });
    if (tierChanged) await SubscriptionLifecycleService.reconcileAlerts(targetUserId);

    await AuditService.log({
      actorId: adminUserId,
      actorType: 'ADMIN',
      action: 'user.update',
      targetType: 'user',
      targetId: targetUserId,
      payload: {
        before: { role: current.role, tier: current.tier, status: current.status },
        after: { role: updates.role, tier: updates.tier, status: updates.status },
      },
    });

    const refreshed = await this.getUserById(targetUserId);
    if (!refreshed) {
      throw AppError.notFound('Failed to fetch updated user.');
    }
    return refreshed;
  }

  /**
   * Resets a user's password (manual or auto-generated)
   */
  static async resetUserPassword(
    callerUserId: string | null,
    targetUserId: string,
    newPassword?: string
  ): Promise<{ temporaryPassword: string }> {
    await this.assertAdminCaller(callerUserId);

    const userRes = await query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = $1`,
      [targetUserId]
    );
    if (userRes.rows.length === 0) {
      throw AppError.notFound('Target user not found.');
    }
    const user = userRes.rows[0];

    const tempPassword =
      newPassword && newPassword.trim().length >= 8
        ? newPassword.trim()
        : `Emd_${randomBytes(4).toString('hex')}!2026`;

    const passwordHash = AuthService.hashPassword(tempPassword);

    await transaction(async (client) => {
      // Upsert credentials account
      await client.query(
        `INSERT INTO accounts (id, user_id, type, provider, provider_account_id, refresh_token)
         VALUES ($1, $2, 'credentials', 'credentials', $3, $4)
         ON CONFLICT (provider, provider_account_id) DO UPDATE SET
           refresh_token = $4`,
        [`acc_${user.id}`, user.id, user.email, passwordHash]
      );

      // Kill all active sessions to force re-login
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
    });

    await AuditService.log({
      actorId: callerUserId,
      actorType: callerUserId ? 'ADMIN' : 'SYSTEM',
      action: 'user.password_reset',
      targetType: 'user',
      targetId: user.id,
      // Never log the credential itself.
      payload: { mode: newPassword ? 'explicit' : 'generated' },
    });

    return { temporaryPassword: tempPassword };
  }

  /**
   * Creates a new user directly by Administrator
   */
  static async createUserByAdmin(
    callerUserId: string | null,
    input: {
    email: string;
    password?: string;
    displayName?: string;
    role?: 'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT';
    tier?: 'FREE' | 'PRO' | 'TEAM';
  }): Promise<{ user: AdminUserListItem; temporaryPassword: string }> {
    await this.assertAdminCaller(callerUserId);

    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw AppError.badRequest('Valid email address is required.');
    }

    const existing = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      throw AppError.conflict('A user with this email address already exists.');
    }

    const tempPassword =
      input.password && input.password.trim().length >= 8
        ? input.password.trim()
        : `Emd_${randomBytes(4).toString('hex')}!2026`;

    const userId = `usr_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
    const passwordHash = AuthService.hashPassword(tempPassword);
    const displayName = input.displayName || email.split('@')[0];
    const role = input.role || 'USER';
    const tier = input.tier || 'FREE';

    await transaction(async (client) => {
      // 1. Insert user
      await client.query(
        `INSERT INTO users (id, email, display_name, role, tier, status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
        [userId, email, displayName, role, tier]
      );

      // 2. Insert credentials account
      await client.query(
        `INSERT INTO accounts (id, user_id, type, provider, provider_account_id, refresh_token)
         VALUES ($1, $2, 'credentials', 'credentials', $3, $4)`,
        [`acc_${userId}`, userId, email, passwordHash]
      );

      // 3. Insert default preferences
      await client.query(
        `INSERT INTO user_preferences (user_id, ui_locale, preferred_markets, preferred_build_types)
         VALUES ($1, 'zh-CN', '{"US"}', '{"TOOL","MICRO_SAAS"}')`,
        [userId]
      );

      // 4. A user created directly at PRO/TEAM needs the matching subscription
      //    row, or the entitlement reader (which no longer consults users.tier)
      //    will treat them as FREE from the first request onward. Written in the
      //    same transaction as the tier so the two can never be observed apart.
      if (tier === 'PRO' || tier === 'TEAM') {
        const snapshot = await readPlanEntitlements(client, tier);
        await client.query(
          `INSERT INTO subscriptions (
             id, user_id, plan_code, status, current_period_start, current_period_end,
             entitlements_snapshot, cancel_at_period_end
           ) VALUES ($1, $2, $3, 'ACTIVE', NOW(), $4::timestamptz, $5::jsonb, false)`,
          [`sub_${userId}`, userId, tier, NO_EXPIRY, JSON.stringify(snapshot ?? {})]
        );
      }
    });

    await AuditService.log({
      actorId: callerUserId,
      actorType: callerUserId ? 'ADMIN' : 'SYSTEM',
      action: 'user.create',
      targetType: 'user',
      targetId: userId,
      payload: { email, role, tier },
    });

    const refreshed = await this.getUserById(userId);
    if (!refreshed) {
      throw AppError.notFound('Failed to fetch newly created user.');
    }
    return {
      user: refreshed,
      temporaryPassword: tempPassword,
    };
  }
}
