import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

const harness = makeDisposableDb('emeradar_seat_caps_test');
const BUYER = 'usr_seat_buyer';

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await harness.db.query(
    `INSERT INTO users (id, email, display_name, role, tier, status)
     VALUES ($1, $2, $1, 'USER', 'FREE', 'ACTIVE')`,
    [BUYER, `${BUYER}@emeradar.test`]
  );
});

after(async () => {
  await harness.teardown();
});

async function seedSubscriber(id: string, lifetime: boolean) {
  await harness.db.query(
    `INSERT INTO users (id, email, display_name, role, tier, status)
     VALUES ($1, $2, $1, 'USER', 'PRO', 'ACTIVE')`,
    [id, `${id}@emeradar.test`]
  );
  await harness.db.query(
    `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start,
       current_period_end, entitlements_snapshot)
     VALUES ($1, $2, 'PRO', 'ACTIVE', NOW(), ${
       lifetime ? "TIMESTAMPTZ '9999-12-31 23:59:59+00'" : "NOW() + INTERVAL '30 days'"
     }, '{}'::jsonb)`,
    [`sub_${id}`, id]
  );
}

describe('Phase 1 席位上限（新定价 2026-10：PRO 200 / FOUNDING 20）', () => {
  it('Pro 满 200 席后月付/年付结账被拒绝，Founding 满 20 席后终身版被拒绝', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService, PRO_SEAT_CAP, FOUNDING_SEAT_CAP } = harness.services;

    // 填满周期订阅席位（200 席）
    for (let i = 0; i < PRO_SEAT_CAP; i++) await seedSubscriber(`usr_seat_rec_${i}`, false);

    for (const billingCycle of ['monthly', 'yearly'] as const) {
      await assert.rejects(
        () => StripeService.createCheckoutSession({ userId: BUYER, planCode: 'PRO', billingCycle }),
        (error: any) => {
          assert.strictEqual(error.code, 'SEATS_FULL');
          assert.strictEqual(error.status, 409);
          return true;
        },
        `${billingCycle} 结账在 Pro 满席后仍被放行`
      );
    }

    // 补满 20 个终身席位：终身版独立受 Founding 上限约束。
    for (let i = 0; i < FOUNDING_SEAT_CAP; i++) await seedSubscriber(`usr_seat_life_${i}`, true);
    await assert.rejects(
      () => StripeService.createCheckoutSession({ userId: BUYER, planCode: 'PRO', billingCycle: 'lifetime' }),
      (error: any) => error.code === 'SEATS_FULL' && error.status === 409,
      '终身版在 Founding 售罄后仍被放行'
    );

    // 被拒绝的结账不该给买家留下订阅。
    const rows = await harness.db.query(`SELECT 1 FROM subscriptions WHERE user_id = $1`, [BUYER]);
    assert.strictEqual(rows.rows.length, 0);
  });
});
