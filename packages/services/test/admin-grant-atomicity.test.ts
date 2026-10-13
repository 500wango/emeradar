import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDisposableDb } from './helpers/disposable-db';

const harness = makeDisposableDb('emeradar_admin_grant_atomicity_test');
const ADMIN = 'usr_admin_grant_test';
const TARGET = 'usr_target_grant_test';

describe('Admin subscription grants are atomic', () => {
  before(async () => {
    await harness.setup();
    if (!harness.available) return;
    await harness.db.query(
      `INSERT INTO users (id, email, role, tier, status) VALUES
       ($1, 'grant_admin@emeradar.test', 'ADMIN', 'FREE', 'ACTIVE'),
       ($2, 'grant_target@emeradar.test', 'USER', 'FREE', 'ACTIVE')`,
      [ADMIN, TARGET]
    );
  });

  after(async () => {
    await harness.teardown();
  });

  it('rolls back the tier mirror and role when the subscription grant fails', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await harness.db.query(`CREATE FUNCTION reject_test_grant() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test grant failure'; END $$`);
    await harness.db.query(`CREATE TRIGGER reject_test_grant BEFORE INSERT OR UPDATE ON subscriptions
      FOR EACH ROW EXECUTE FUNCTION reject_test_grant()`);
    try {
      await assert.rejects(
        () => harness.services.AdminService.updateUser(ADMIN, TARGET, { role: 'ANALYST', tier: 'PRO' }),
        /test grant failure/
      );
      const user = (await harness.db.query<{ role: string; tier: string }>(
        `SELECT role, tier FROM users WHERE id = $1`, [TARGET]
      )).rows[0];
      assert.deepEqual(user, { role: 'USER', tier: 'FREE' });
      const subs = await harness.db.query(`SELECT id FROM subscriptions WHERE user_id = $1`, [TARGET]);
      assert.equal(subs.rows.length, 0);
    } finally {
      await harness.db.query(`DROP TRIGGER reject_test_grant ON subscriptions`);
      await harness.db.query(`DROP FUNCTION reject_test_grant()`);
    }
  });

  it('commits a matching paid subscription and mirror together', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const user = await harness.services.AdminService.updateUser(ADMIN, TARGET, { tier: 'PRO' });
    assert.equal(user.tier, 'PRO');
    assert.equal(user.subscriptionPlanCode, 'PRO');
    const sub = (await harness.db.query<{ status: string; plan_code: string }>(
      `SELECT status, plan_code FROM subscriptions WHERE user_id = $1`, [TARGET]
    )).rows[0];
    assert.deepEqual(sub, { status: 'ACTIVE', plan_code: 'PRO' });
  });
});
