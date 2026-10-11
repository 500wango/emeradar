import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { query, closePool } from '@emeradar/db';
import { EntitlementService } from '../src';

/**
 * The quota a user is *shown* and the quota that is *enforced* must come from
 * the same reading of the database.
 *
 * They used to be resolved by four near-identical queries that had drifted
 * apart: `getUserEntitlements` ignored TRIALING subscriptions, and
 * `reserveLiveScanQuota` ignored the legacy `users.tier` fallback. Each
 * divergence meant the UI reported a limit the API did not honour.
 */
describe('Entitlement display/enforcement parity', () => {
  const legacyUserId = 'usr_test_parity_legacy';
  const trialUserId = 'usr_test_parity_trial';

  async function cleanup() {
    for (const userId of [legacyUserId, trialUserId]) {
      await query(`DELETE FROM usage_counters WHERE user_id = $1`, [userId]);
      await query(`DELETE FROM subscriptions WHERE user_id = $1`, [userId]);
      await query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  }

  before(async () => {
    await cleanup();

    // A pre-existing paid account whose plan lives on `users.tier` and which has
    // no subscription row — the legacy shape 13 §3.1 / 24 §6 keeps working.
    await query(
      `INSERT INTO users (id, email, display_name, role, tier, status)
       VALUES ($1, 'parity-legacy@example.com', 'Legacy Team', 'USER', 'TEAM', 'ACTIVE')`,
      [legacyUserId]
    );

    // A trial is entitled to its plan while it runs.
    await query(
      `INSERT INTO users (id, email, display_name, role, tier, status)
       VALUES ($1, 'parity-trial@example.com', 'Trial Pro', 'USER', 'FREE', 'ACTIVE')`,
      [trialUserId]
    );
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_end)
       VALUES ($1, $2, 'PRO', 'TRIALING', NOW() + INTERVAL '7 days')`,
      [`sub_${trialUserId}`, trialUserId]
    );
  });

  after(async () => {
    await cleanup();
    await closePool();
  });

  it('reports and enforces the same daily scan limit for a legacy tier', async () => {
    const displayed = await EntitlementService.getUserEntitlements(legacyUserId);
    assert.strictEqual(displayed.planCode, 'TEAM');
    assert.strictEqual(displayed.liveScanDailyLimit, 100);

    const reserved = await EntitlementService.reserveLiveScanQuota(legacyUserId);
    assert.strictEqual(reserved.limit, displayed.liveScanDailyLimit);
    assert.strictEqual(reserved.remaining, 99);

    // The regression this pins: enforcement used to fall back to FREE, so the
    // fourth scan of the day was refused while the UI advertised 100.
    await EntitlementService.reserveLiveScanQuota(legacyUserId);
    const fourth = await EntitlementService.reserveLiveScanQuota(legacyUserId);
    assert.strictEqual(fourth.used, 3);
  });

  it('treats a TRIALING subscription as entitled on the read side too', async () => {
    const displayed = await EntitlementService.getUserEntitlements(trialUserId);
    assert.strictEqual(displayed.planCode, 'PRO');
    assert.strictEqual(displayed.liveScanDailyLimit, 30);
    assert.strictEqual(displayed.opportunityDetailFull, true);

    const reserved = await EntitlementService.reserveLiveScanQuota(trialUserId);
    assert.strictEqual(reserved.limit, 30);
  });

  it('falls back to FREE when neither a subscription nor a paid tier exists', async () => {
    const freeUserId = 'usr_test_parity_free';
    await query(`DELETE FROM users WHERE id = $1`, [freeUserId]);
    await query(
      `INSERT INTO users (id, email, display_name, role, tier, status)
       VALUES ($1, 'parity-free@example.com', 'Free', 'USER', 'FREE', 'ACTIVE')`,
      [freeUserId]
    );

    const displayed = await EntitlementService.getUserEntitlements(freeUserId);
    assert.strictEqual(displayed.planCode, 'FREE');
    assert.strictEqual(displayed.liveScanDailyLimit, 3);

    const reserved = await EntitlementService.reserveLiveScanQuota(freeUserId);
    assert.strictEqual(reserved.limit, 3);

    await query(`DELETE FROM usage_counters WHERE user_id = $1`, [freeUserId]);
    await query(`DELETE FROM users WHERE id = $1`, [freeUserId]);
  });
});
