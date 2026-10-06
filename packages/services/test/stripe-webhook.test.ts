import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { StripeService } from '../src/stripe.service';

describe('Stripe Webhook Verification Security', () => {
  const secret = 'whsec_test_secret_123456';
  const payload = JSON.stringify({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_mock',
        metadata: { userId: 'usr_attacker', planCode: 'TEAM' },
      },
    },
  });

  function signPayload(body: string, sec: string, timestamp = Math.floor(Date.now() / 1000)) {
    const signature = crypto
      .createHmac('sha256', sec)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  it('valid signature passes verification', () => {
    const header = signPayload(payload, secret);
    const valid = StripeService.verifyWebhookSignature(payload, header, secret);
    assert.strictEqual(valid, true);
  });

  it('tampered payload is rejected', () => {
    const header = signPayload(payload, secret);
    const tamperedPayload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_mock',
          metadata: { userId: 'usr_attacker', planCode: 'FREE' },
        },
      },
    });
    const valid = StripeService.verifyWebhookSignature(tamperedPayload, header, secret);
    assert.strictEqual(valid, false);
  });

  it('tampered secret is rejected', () => {
    const header = signPayload(payload, 'whsec_wrong_secret');
    const valid = StripeService.verifyWebhookSignature(payload, header, secret);
    assert.strictEqual(valid, false);
  });

  it('malformed or missing header parts fail closed', () => {
    assert.strictEqual(StripeService.verifyWebhookSignature(payload, '', secret), false);
    assert.strictEqual(StripeService.verifyWebhookSignature(payload, 'invalid_header', secret), false);
    assert.strictEqual(StripeService.verifyWebhookSignature(payload, 't=12345', secret), false);
    assert.strictEqual(StripeService.verifyWebhookSignature(payload, 'v1=abcd', secret), false);
  });
});
