import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { query, closePool } from '@emeradar/db';
import { AuditService, AuthService, EntitlementService, ProjectService } from '../src';

/**
 * Regression cover for the review fixes that only show up against a real
 * database: the atomic rate-limit bucket, the audit trail's INET handling, the
 * set-based GSC upserts, partial preference updates, and entitlements following
 * account status.
 */
describe('Review fixes (rate limit, audit, GSC batching, preferences, entitlements)', () => {
  const userId = 'usr_test_fixcheck';
  const projectId = 'prj_test_fixcheck';
  const stamp = Date.now();

  before(async () => {
    // The suite owns this identity: clear any leftover row (a previous aborted
    // run, or a different id holding the same email) before inserting.
    await query(`DELETE FROM users WHERE email = $1 OR id = $2`, ['fixcheck@example.com', userId]);
    await query(
      `INSERT INTO users (id, email, display_name, role, tier, status)
       VALUES ($1, $2, 'Fix Check', 'USER', 'PRO', 'ACTIVE')`,
      [userId, 'fixcheck@example.com']
    );
    // The subscription row is what actually grants PRO — `users.tier` is only a
    // display mirror (see entitlement.service.ts). A tier-only fixture would now
    // be a FREE account, and the assertion at the end of this file would be
    // testing nothing. Cascades away with the user row in `after`.
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start, current_period_end, entitlements_snapshot)
       VALUES ($1, $2, 'PRO', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days', '{}'::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET
         plan_code = 'PRO', status = 'ACTIVE', current_period_end = NOW() + INTERVAL '30 days'`,
      [`sub_${userId}`, userId]
    );
    await query(
      `INSERT INTO projects (id, user_id, project_kind, title, domain, build_type, status, stake_deadline_at)
       VALUES ($1, $2, 'EXPERIMENT', 'Fix Check', 'fixcheck.example', 'TOOL', 'IN_DEVELOPMENT', NOW() + INTERVAL '7 days')
       ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [projectId, userId]
    );
  });

  after(async () => {
    await query(`DELETE FROM gsc_metrics_daily WHERE project_id = $1`, [projectId]);
    await query(`DELETE FROM gsc_metrics_weekly_detail WHERE project_id = $1`, [projectId]);
    await query(`DELETE FROM gsc_metrics_weekly WHERE project_id = $1`, [projectId]);
    await query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    await query(`DELETE FROM user_preferences WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM audit_log WHERE action = 'test.fixcheck'`);
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
    await closePool();
  });

  it('consumes rate-limit buckets atomically and never counts a peek', async () => {
    const { checkRateLimit, peekRateLimit, resetRateLimit } = await import(
      '../../../apps/web/src/lib/rate-limit'
    );
    const key = `test_rl_${stamp}`;
    const first = await checkRateLimit({ key, limit: 3, windowMs: 60_000 });
    assert.strictEqual(first.success, true);
    assert.strictEqual(first.remaining, 2);

    const peeked = await peekRateLimit({ key, limit: 3, windowMs: 60_000 });
    assert.strictEqual(peeked.success, true);
    assert.strictEqual(peeked.remaining, 2, 'peek must not consume a slot');

    await checkRateLimit({ key, limit: 3, windowMs: 60_000 });
    await checkRateLimit({ key, limit: 3, windowMs: 60_000 });
    const blocked = await checkRateLimit({ key, limit: 3, windowMs: 60_000 });
    assert.strictEqual(blocked.success, false);
    assert.strictEqual((await peekRateLimit({ key, limit: 3, windowMs: 60_000 })).success, false);

    await resetRateLimit(key);
    assert.strictEqual((await peekRateLimit({ key, limit: 3, windowMs: 60_000 })).remaining, 3);
  });

  it('counts every concurrent first hit instead of resetting the window', async () => {
    const { checkRateLimit } = await import('../../../apps/web/src/lib/rate-limit');
    const key = `test_rlrace_${stamp}`;
    await Promise.all(
      Array.from({ length: 10 }, () => checkRateLimit({ key, limit: 5, windowMs: 60_000 }))
    );
    const res = await query<{ count: number }>(
      `SELECT count FROM rate_limit_buckets WHERE bucket_key = $1`,
      [key]
    );
    assert.strictEqual(Number(res.rows[0]?.count), 10);
  });

  it('writes audit entries and refuses a malformed INET value', async () => {
    await AuditService.log({
      actorId: null,
      actorType: 'SYSTEM',
      action: 'test.fixcheck',
      targetType: 'test',
      targetId: 'it_1',
      payload: { ok: true },
      ip: 'not an ip address!',
    });
    const res = await query<{ action: string; ip: string | null }>(
      `SELECT action, ip FROM audit_log WHERE action = 'test.fixcheck' ORDER BY occurred_at DESC LIMIT 1`
    );
    assert.strictEqual(res.rows[0]?.action, 'test.fixcheck');
    assert.strictEqual(res.rows[0]?.ip, null);
  });

  it('upserts GSC weekly detail in one batch and stays idempotent', async () => {
    const rows = [
      { weekStartDate: '2026-09-07', pageUrl: '/a', query: 'alpha', impressions: 10, clicks: 1, averagePosition: 3.5, source: 'GSC' },
      { weekStartDate: '2026-09-07', pageUrl: '/b', query: 'beta', impressions: 20, clicks: 2, averagePosition: 7.25, source: 'GSC' },
    ];
    assert.strictEqual((await ProjectService.upsertGscWeeklyDetails(projectId, userId, rows)).count, 2);
    assert.strictEqual((await ProjectService.upsertGscWeeklyDetails(projectId, userId, rows)).count, 2);

    const detail = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM gsc_metrics_weekly_detail WHERE project_id = $1`,
      [projectId]
    );
    assert.strictEqual(Number(detail.rows[0]?.n), 2, 'a repeat sync must update, not duplicate');

    assert.strictEqual((await ProjectService.upsertGscWeeklyDetails(projectId, userId, [])).count, 0);
  });

  it('buckets GSC daily rows by week and aggregates each week separately', async () => {
    const synced = await ProjectService.syncGscSearchAnalytics(projectId, userId, [
      { date: '2026-09-07', page: '/a', query: 'alpha', impressions: 10, clicks: 1, position: 3.5 },
      { date: '2026-09-08', page: '/a', query: 'alpha', impressions: 12, clicks: 2, position: 4.0 },
      { date: '2026-09-15', page: '/b', query: 'beta', impressions: 5, clicks: 0, position: 9.0 },
    ]);
    assert.strictEqual(synced.weekStartDates.join(','), '2026-09-07,2026-09-14');

    const weekly = await query<{ week_start_date: string; impressions: number }>(
      `SELECT week_start_date::text, impressions FROM gsc_metrics_weekly
       WHERE project_id = $1 AND week_start_date >= '2026-09-07' ORDER BY 1`,
      [projectId]
    );
    assert.strictEqual(weekly.rows.length, 2);
    assert.strictEqual(Number(weekly.rows[0].impressions), 22);
    assert.strictEqual(Number(weekly.rows[1].impressions), 5);
  });

  it('keeps omitted preference keys instead of resetting them', async () => {
    await AuthService.updatePreferences(userId, {
      uiLocale: 'zh-CN',
      preferredMarkets: ['US', 'DE'],
      preferredBuildTypes: ['TOOL'],
      topics: ['seo'],
      onboardingCompleted: true,
    });
    await AuthService.updatePreferences(userId, { uiLocale: 'en-US' });

    const res = await query<{
      ui_locale: string;
      preferred_markets: string[];
      preferred_build_types: string[];
      topics: string[];
      onboarding_completed: boolean;
    }>(`SELECT * FROM user_preferences WHERE user_id = $1`, [userId]);
    const pref = res.rows[0];
    assert.strictEqual(pref.ui_locale, 'en-US');
    assert.deepStrictEqual(pref.preferred_markets, ['US', 'DE']);
    assert.deepStrictEqual(pref.preferred_build_types, ['TOOL']);
    assert.deepStrictEqual(pref.topics, ['seo']);
    assert.strictEqual(pref.onboarding_completed, true);

    // An explicit empty array is still a deliberate clear.
    await AuthService.updatePreferences(userId, { topics: [] });
    const cleared = await query<{ topics: string[] }>(
      `SELECT topics FROM user_preferences WHERE user_id = $1`,
      [userId]
    );
    assert.deepStrictEqual(cleared.rows[0]?.topics, []);

    // `preferred_time_budget` is nullable, so an explicit null has to clear it
    // while an omitted key keeps it — COALESCE alone cannot tell the two apart.
    await AuthService.updatePreferences(userId, { preferredTimeBudget: 'TWO_WEEKS' });
    await AuthService.updatePreferences(userId, { uiLocale: 'zh-CN' });
    const kept = await query<{ preferred_time_budget: string | null }>(
      `SELECT preferred_time_budget FROM user_preferences WHERE user_id = $1`,
      [userId]
    );
    assert.strictEqual(kept.rows[0]?.preferred_time_budget, 'TWO_WEEKS');

    await AuthService.updatePreferences(userId, { preferredTimeBudget: null });
    const nulled = await query<{ preferred_time_budget: string | null }>(
      `SELECT preferred_time_budget FROM user_preferences WHERE user_id = $1`,
      [userId]
    );
    assert.strictEqual(nulled.rows[0]?.preferred_time_budget, null);
  });

  it('drops paid entitlements while the account is suspended', async () => {
    const active = await EntitlementService.getUserEntitlements(userId);
    assert.strictEqual(active.opportunityDetailFull, true);

    await query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [userId]);
    const suspended = await EntitlementService.getUserEntitlements(userId);
    assert.strictEqual(suspended.planCode, 'FREE');
    assert.strictEqual(suspended.opportunityDetailFull, false);

    await query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [userId]);
  });
});
