import { query, transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';

export interface CheckoutSessionOptions {
  userId: string;
  planCode: 'PRO' | 'TEAM';
  billingCycle?: 'monthly' | 'yearly' | 'lifetime';
  returnUrl?: string;
}

function safeReturnUrl(value: string | undefined): string {
  const fallback = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/pricing`;
  if (!value) return fallback;
  try {
    const parsed = new URL(value, fallback);
    const base = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith('/')) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

export class StripeService {
  /**
   * Creates a Stripe Checkout Session for subscription upgrade
   */
  static async createCheckoutSession(opts: CheckoutSessionOptions): Promise<{ url: string; sessionId: string }> {
    const { userId, planCode, billingCycle = 'yearly' } = opts;

    const userRes = await query<{ id: string; email: string; tier: string }>(
      `SELECT id, email, tier FROM users WHERE id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, 'User not found.', 404);
    }

    const user = userRes.rows[0];
    const returnUrl = safeReturnUrl(opts.returnUrl);

    const planPrices = {
      PRO: {
        name: 'Builder Pro',
        monthly: 2900, // $29
        yearly: 29000, // ~$24/mo * 12 = $290 (2 months free)
      },
      TEAM: {
        name: 'Scale Team',
        monthly: 14900, // $149
        yearly: 142800, // $119/mo * 12 = $1,428
      },
    };

    const config = planPrices[planCode] || planPrices.PRO;
    const isLifetime = billingCycle === 'lifetime';
    const amountCents = isLifetime ? 39900 : billingCycle === 'yearly' ? config.yearly : config.monthly;
    const interval = billingCycle === 'yearly' ? 'year' : 'month';

    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeKey) {
      // Dev / Test mode simulation: Directly upgrade subscription in DB if Stripe key is unconfigured
      console.warn('[StripeService] STRIPE_SECRET_KEY not set in environment. Running dev mock activation.');
      await this.activateSubscription(userId, planCode, billingCycle);
      return {
        url: `${returnUrl}?session_id=mock_sub_${Date.now()}&status=success`,
        sessionId: `mock_sess_${Date.now()}`,
      };
    }

    const form = new URLSearchParams();
    form.append('mode', isLifetime ? 'payment' : 'subscription');
    form.append('payment_method_types[]', 'card');
    form.append('client_reference_id', userId);
    form.append('customer_email', user.email);
    form.append('line_items[0][price_data][currency]', 'usd');
    form.append('line_items[0][price_data][product_data][name]', `Emeradar ${config.name} (${isLifetime ? 'Founding Lifetime' : billingCycle})`);
    form.append('line_items[0][price_data][unit_amount]', String(amountCents));
    if (!isLifetime) form.append('line_items[0][price_data][recurring][interval]', interval);
    form.append('line_items[0][quantity]', '1');
    form.append('success_url', `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&success=true`);
    form.append('cancel_url', `${returnUrl}?canceled=true`);
    form.append('metadata[userId]', userId);
    form.append('metadata[planCode]', planCode);
    form.append('metadata[billingCycle]', billingCycle);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new EmeradarError(
        ErrorCode.INTERNAL,
        data.error?.message || 'Failed to initialize Stripe checkout session.',
        res.status || 500
      );
    }

    return {
      url: data.url,
      sessionId: data.id,
    };
  }

  /**
   * Activates subscription for a user upon successful checkout
   */
  static async activateSubscription(userId: string, planCode: 'PRO' | 'TEAM', billingCycle: 'monthly' | 'yearly' | 'lifetime' = 'monthly'): Promise<void> {
    await transaction(async (client) => {
      await client.query(
        `UPDATE users SET tier = $2, updated_at = NOW() WHERE id = $1`,
        [userId, planCode]
      );

      const subId = `sub_${Date.now().toString(36)}`;
      await client.query(
        `INSERT INTO subscriptions (
          id, user_id, plan_code, status, current_period_start, current_period_end
        ) VALUES (
          $1, $2, $3, 'ACTIVE', NOW(), CASE
            WHEN $4 = 'lifetime' THEN TIMESTAMPTZ '9999-12-31 23:59:59+00'
            WHEN $4 = 'yearly' THEN NOW() + interval '1 year'
            ELSE NOW() + interval '1 month'
          END
        )
        ON CONFLICT (user_id) DO UPDATE SET
          plan_code = EXCLUDED.plan_code,
          status = 'ACTIVE',
          current_period_end = CASE
            WHEN $4 = 'lifetime' THEN TIMESTAMPTZ '9999-12-31 23:59:59+00'
            WHEN $4 = 'yearly' THEN NOW() + interval '1 year'
            ELSE NOW() + interval '1 month'
          END`,
        [subId, userId, planCode, billingCycle]
      );
    });
  }

  /**
   * Verifies a completed checkout session and ensures subscription is active
   */
  static async verifyAndActivateSession(sessionId: string, expectedUserId?: string): Promise<boolean> {
    if (!sessionId) return false;
    if (sessionId.startsWith('mock_sess_') || sessionId.startsWith('mock_sub_')) {
      return true;
    }
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return true;

    try {
      const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!res.ok) return false;
      const session = await res.json();
      if (session.payment_status === 'paid' || session.status === 'complete') {
        const userId = session.metadata?.userId || session.client_reference_id;
        if (expectedUserId && userId !== expectedUserId) return false;
        const planCode = (session.metadata?.planCode as 'PRO' | 'TEAM') || 'PRO';
        if (userId) {
          const billingCycle = session.metadata?.billingCycle === 'lifetime'
            ? 'lifetime'
            : session.metadata?.billingCycle === 'yearly'
            ? 'yearly'
            : 'monthly';
          await this.activateSubscription(userId, planCode, billingCycle);
          return true;
        }
      }
    } catch (err) {
      console.error('[StripeService] Error verifying checkout session:', err);
    }
    return false;
  }

  /**
   * Downgrades subscription to FREE
   */
  static async deactivateSubscription(userId: string): Promise<void> {
    await transaction(async (client) => {
      await client.query(
        `UPDATE users SET tier = 'FREE', updated_at = NOW() WHERE id = $1`,
        [userId]
      );
      await client.query(
        `UPDATE subscriptions SET status = 'CANCELED' WHERE user_id = $1`,
        [userId]
      );
    });
  }

  /**
   * Verifies Stripe Webhook signature (HMAC-SHA256)
   */
  static verifyWebhookSignature(payload: string, header: string, secret: string, maxAgeSec = 600): boolean {
    try {
      const parts = header.split(',');
      const timestampPart = parts.find((p) => p.startsWith('t='));
      const sigPart = parts.find((p) => p.startsWith('v1='));
      if (!timestampPart || !sigPart) return false;

      const timestamp = timestampPart.slice(2);
      const signature = sigPart.slice(3);

      // Replay protection: reject signatures older than maxAgeSec.
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > maxAgeSec) return false;

      const crypto = require('node:crypto');
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${payload}`)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }
}
