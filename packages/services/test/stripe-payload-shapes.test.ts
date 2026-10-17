import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  invoicePeriodEnd,
  invoiceSubscriptionId,
  subscriptionPeriodEnd,
} from '../src/stripe.service';

/**
 * Stripe API 2025-03-31 ("Basil") moved two fields the billing webhook reads:
 * `subscription.current_period_end` → `subscription.items.data[].current_period_end`,
 * and `invoice.subscription` → `invoice.parent.subscription_details.subscription`.
 *
 * A brand-new Stripe account's endpoint sends the new shape, so these are the
 * cases that decide whether a renewal extends access and whether a failed payment
 * ever enters PAST_DUE. Both shapes must resolve; anything else must be null
 * (which the caller treats as "no period end"), never a guess.
 */
describe('Stripe webhook payload shapes across API versions', () => {
  describe('subscriptionPeriodEnd', () => {
    it('reads the pre-Basil top-level field', () => {
      assert.strictEqual(subscriptionPeriodEnd({ current_period_end: 1767225600 }), 1767225600);
    });

    it('reads the Basil item-level field', () => {
      const obj = {
        items: { data: [{ id: 'si_1', current_period_end: 1767225600 }] },
      };
      assert.strictEqual(subscriptionPeriodEnd(obj), 1767225600);
    });

    it('prefers the top-level field when both are present', () => {
      const obj = {
        current_period_end: 1700000000,
        items: { data: [{ current_period_end: 1767225600 }] },
      };
      assert.strictEqual(subscriptionPeriodEnd(obj), 1700000000);
    });

    it('returns null when neither shape carries a period', () => {
      assert.strictEqual(subscriptionPeriodEnd({ id: 'sub_1' }), null);
      assert.strictEqual(subscriptionPeriodEnd({ items: { data: [] } }), null);
      assert.strictEqual(subscriptionPeriodEnd(null), null);
    });

    it('ignores non-finite values instead of storing an invalid date', () => {
      assert.strictEqual(subscriptionPeriodEnd({ current_period_end: '1767225600' }), null);
      assert.strictEqual(
        subscriptionPeriodEnd({ items: { data: [{ current_period_end: Number.NaN }] } }),
        null
      );
    });
  });

  describe('invoiceSubscriptionId', () => {
    it('reads the pre-Basil top-level field', () => {
      assert.strictEqual(invoiceSubscriptionId({ subscription: 'sub_legacy' }), 'sub_legacy');
    });

    it('reads the Basil nested field', () => {
      const obj = { parent: { subscription_details: { subscription: 'sub_basil' } } };
      assert.strictEqual(invoiceSubscriptionId(obj), 'sub_basil');
    });

    it('accepts an expanded subscription object', () => {
      const obj = { parent: { subscription_details: { subscription: { id: 'sub_expanded' } } } };
      assert.strictEqual(invoiceSubscriptionId(obj), 'sub_expanded');
    });

    it('returns null for a one-off invoice (no subscription either way)', () => {
      assert.strictEqual(invoiceSubscriptionId({ id: 'in_1', parent: null }), null);
      assert.strictEqual(invoiceSubscriptionId({ subscription: null }), null);
    });
  });

  describe('invoicePeriodEnd', () => {
    it('reads the first line item period end', () => {
      const obj = { lines: { data: [{ period: { start: 1, end: 1767225600 } }] } };
      assert.strictEqual(invoicePeriodEnd(obj), 1767225600);
    });

    it('returns null when the invoice has no lines', () => {
      assert.strictEqual(invoicePeriodEnd({ lines: { data: [] } }), null);
      assert.strictEqual(invoicePeriodEnd({}), null);
    });
  });
});
