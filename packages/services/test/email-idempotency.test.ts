import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTransactionalEmail } from '../src/email.service';

test('email retries carry stable provider idempotency keys and a bounded timeout', async () => {
  const original = globalThis.fetch;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;
  process.env.RESEND_API_KEY = 'test-placeholder';
  process.env.ALERT_FROM_EMAIL = 'test@example.invalid';
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).get('Idempotency-Key'), 'alert/test-event');
    assert.ok(init.signal);
    return { ok: true };
  }) as any;
  try {
    const message = { to: 'user@example.invalid', subject: 'Test', text: 'Test', idempotencyKey: 'alert/test-event' };
    assert.equal(await sendTransactionalEmail(message), true);
    assert.equal(await sendTransactionalEmail(message), true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = key;
    if (from === undefined) delete process.env.ALERT_FROM_EMAIL; else process.env.ALERT_FROM_EMAIL = from;
  }
});
