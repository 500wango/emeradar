import { before, after, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeDisposableDb } from './helpers/disposable-db';
const h = makeDisposableDb('emeradar_stripe_retry_test');
before(async () => { await h.setup(); if (h.available) await h.db.query(fs.readFileSync(path.resolve(__dirname,'../../db/src/payment-history.sql'),'utf8')); });
after(async () => { await h.teardown(); });

test('subscription retry commits cancellation and completion together; completed retry is not replayed', async t => {
  if (!h.available) return t.skip(h.skipReason);
  await h.db.query(`INSERT INTO users (id, email, tier) VALUES ('retry_user', 'retry@emeradar.test', 'PRO')`);
  await h.db.query(`INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start, current_period_end, stripe_subscription_id)
    VALUES ('retry_sub', 'retry_user', 'PRO', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days', 'sub_retry')`);
  await h.db.query(`INSERT INTO stripe_event_retries (event_id,event_type,object_id)
    VALUES ('evt_cancel','customer.subscription.deleted','sub_retry')`);
  // Inject a failure after mutation: no cancellation may leak out of the retry transaction.
  await h.db.query(`CREATE FUNCTION reject_retry_completion() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status = 'DONE' THEN RAISE EXCEPTION 'test completion failure'; END IF; RETURN NEW; END $$`);
  await h.db.query(`CREATE TRIGGER reject_retry_completion BEFORE UPDATE ON stripe_event_retries
    FOR EACH ROW EXECUTE FUNCTION reject_retry_completion()`);
  const original = globalThis.fetch;
  const key = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'test-placeholder';
  let reads = 0;
  globalThis.fetch = (async () => { reads++; return { ok: true, json: async () => ({
    id: 'evt_cancel', type: 'customer.subscription.deleted', data: { object: { id: 'sub_retry' } },
  }) }; }) as any;
  try {
    await h.services.retryStripeAttributions().catch(() => undefined);
    assert.equal((await h.db.query(`SELECT status FROM subscriptions WHERE id = 'retry_sub'`)).rows[0].status, 'ACTIVE');
    assert.equal((await h.db.query(`SELECT id FROM webhook_events WHERE id = 'evt_cancel'`)).rows.length, 0);
    await h.db.query(`DROP TRIGGER reject_retry_completion ON stripe_event_retries`);
    await h.db.query(`UPDATE stripe_event_retries SET next_attempt_at = NOW() WHERE event_id = 'evt_cancel'`);
    assert.equal((await h.services.retryStripeAttributions()).completed, 1);
    assert.equal((await h.db.query(`SELECT status FROM subscriptions WHERE id = 'retry_sub'`)).rows[0].status, 'CANCELED');
    const before = reads;
    assert.equal((await h.services.retryStripeAttributions()).completed, 0);
    assert.equal(reads, before);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = key;
    await h.db.query(`DROP TRIGGER IF EXISTS reject_retry_completion ON stripe_event_retries`);
    await h.db.query(`DROP FUNCTION reject_retry_completion()`);
  }
});

test('failed attribution survives delivery and does not reset retry state', async t => {
  if (!h.available) return t.skip(h.skipReason);
  const { StripeService } = h.services;
  await assert.rejects(() => StripeService.recordAttributionFailure('charge.refunded', 'evt_retry_test', { id: 'ch_test' }));
  const row = (await h.db.query(`SELECT * FROM stripe_event_retries WHERE event_id = 'evt_retry_test'`)).rows[0];
  assert.equal(row.status, 'PENDING');
  await h.db.query(`UPDATE stripe_event_retries SET attempts = 4 WHERE event_id = 'evt_retry_test'`);
  await assert.rejects(() => StripeService.recordAttributionFailure('charge.refunded', 'evt_retry_test', { id: 'ch_test' }));
  assert.equal((await h.db.query(`SELECT attempts FROM stripe_event_retries WHERE event_id = 'evt_retry_test'`)).rows[0].attempts, 4);
});

test('transient API errors back off; exhausted unresolved events remain visible', async t => {
  if (!h.available) return t.skip(h.skipReason);
  const original = globalThis.fetch;
  const oldKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'test-placeholder';
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 503 })) as any;
    await h.services.retryStripeAttributions();
    let row = (await h.db.query(`SELECT * FROM stripe_event_retries WHERE event_id = 'evt_retry_test'`)).rows[0];
    assert.equal(row.attempts, 5);
    assert.equal(row.status, 'PENDING');
    await h.db.query(`UPDATE stripe_event_retries SET next_attempt_at = NOW(), attempts = 11 WHERE event_id = 'evt_retry_test'`);
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({
      id: 'evt_retry_test', type: 'charge.refunded', data: { object: { id: 'ch_test' } },
    }) })) as any;
    const result = await h.services.retryStripeAttributions();
    assert.equal(result.failed, 1);
    row = (await h.db.query(`SELECT * FROM stripe_event_retries WHERE event_id = 'evt_retry_test'`)).rows[0];
    assert.equal(row.status, 'FAILED');
    assert.match(row.last_error, /identity mismatch/);
  } finally {
    globalThis.fetch = original;
    if (oldKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldKey;
  }
});
