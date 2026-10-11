import { query, transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface CheckoutSessionOptions {
  userId: string;
  planCode: 'PRO' | 'TEAM';
  billingCycle?: 'monthly' | 'yearly' | 'lifetime';
  returnUrl?: string;
}

export interface StripeLinkOptions {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  /** When provided (from Stripe), the period end is used verbatim instead of being recomputed. */
  currentPeriodEnd?: string | null;
}

const PLAN_PRICES = {
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
} as const;

const LIFETIME_AMOUNT_CENTS = 39900;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
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
   * Creates a Stripe Checkout Session for a subscription upgrade.
   *
   * Fails closed in production: if no Stripe key is configured we refuse to
   * create a session instead of silently activating entitlements without payment.
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

    const config = PLAN_PRICES[planCode] ?? PLAN_PRICES.PRO;
    const isLifetime = billingCycle === 'lifetime';
    const amountCents = isLifetime
      ? LIFETIME_AMOUNT_CENTS
      : billingCycle === 'yearly'
      ? config.yearly
      : config.monthly;
    const interval = billingCycle === 'yearly' ? 'year' : 'month';

    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeKey) {
      // Fail closed: never grant paid entitlements because of a missing secret.
      // The dev/test simulation is only reachable outside production.
      if (isProduction()) {
        console.error('[StripeService] STRIPE_SECRET_KEY is not configured; refusing to create a checkout session.');
        throw new EmeradarError(
          ErrorCode.INTERNAL,
          'Billing is temporarily unavailable. Please try again later.',
          503
        );
      }
      console.warn('[StripeService] STRIPE_SECRET_KEY not set (non-production). Running dev mock activation.');
      await this.activateSubscription(userId, planCode, billingCycle);
      return {
        url: `${returnUrl}?session_id=mock_sub_${Date.now()}&status=success`,
        sessionId: `mock_sess_${Date.now()}`,
      };
    }

    // Do not open a second subscription for a user who already has a live one.
    const existing = await query<{ id: string }>(
      `SELECT id FROM subscriptions
        WHERE user_id = $1 AND status = 'ACTIVE' AND plan_code <> 'FREE'
          AND (current_period_end IS NULL OR current_period_end > NOW())`,
      [userId]
    );
    if (existing.rows.length > 0) {
      throw new EmeradarError(
        ErrorCode.CONFLICT,
        'You already have an active subscription. Manage it from the billing page.',
        409
      );
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

    // Session metadata is NOT copied onto the objects Stripe creates. We must
    // mirror it onto the subscription / payment intent so later lifecycle
    // webhooks (cancel, payment failure, dispute) can be attributed to a user.
    if (isLifetime) {
      form.append('payment_intent_data[metadata][userId]', userId);
      form.append('payment_intent_data[metadata][planCode]', planCode);
      form.append('payment_intent_data[metadata][billingCycle]', billingCycle);
    } else {
      form.append('subscription_data[metadata][userId]', userId);
      form.append('subscription_data[metadata][planCode]', planCode);
      form.append('subscription_data[metadata][billingCycle]', billingCycle);
    }

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
        'Failed to initialize the checkout session. Please try again later.',
        res.status || 500
      );
    }

    return {
      url: data.url,
      sessionId: data.id,
    };
  }

  /**
   * Activates (or refreshes) a subscription for a user.
   *
   * Idempotent by design: when Stripe supplies the authoritative period end we
   * store it verbatim, so a redelivered webhook cannot silently extend access.
   */
  static async activateSubscription(
    userId: string,
    planCode: 'PRO' | 'TEAM',
    billingCycle: 'monthly' | 'yearly' | 'lifetime' = 'monthly',
    link: StripeLinkOptions = {}
  ): Promise<void> {
    await transaction(async (client) => {
      await client.query(
        `UPDATE users SET tier = $2, updated_at = NOW() WHERE id = $1`,
        [userId, planCode]
      );

      const subId = `sub_${randomUUID()}`;
      const periodEndSql = `CASE
        WHEN $4 = 'lifetime' THEN TIMESTAMPTZ '9999-12-31 23:59:59+00'
        WHEN $5::timestamptz IS NOT NULL THEN $5::timestamptz
        WHEN $4 = 'yearly' THEN NOW() + interval '1 year'
        ELSE NOW() + interval '1 month'
      END`;

      await client.query(
        `INSERT INTO subscriptions (
          id, user_id, plan_code, status, current_period_start, current_period_end,
          stripe_customer_id, stripe_subscription_id
        ) VALUES (
          $1, $2, $3, 'ACTIVE', NOW(), ${periodEndSql}, $6, $7
        )
        ON CONFLICT (user_id) DO UPDATE SET
          plan_code = EXCLUDED.plan_code,
          status = 'ACTIVE',
          current_period_end = EXCLUDED.current_period_end,
          stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
          stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id)`,
        [
          subId,
          userId,
          planCode,
          billingCycle,
          link.currentPeriodEnd ?? null,
          link.stripeCustomerId ?? null,
          link.stripeSubscriptionId ?? null,
        ]
      );
    });
  }

  /**
   * Verifies a completed checkout session and ensures the subscription is active.
   *
   * Fails closed: an unconfigured Stripe key or an unverifiable session never
   * results in entitlements being granted.
   */
  static async verifyAndActivateSession(sessionId: string, expectedUserId?: string): Promise<boolean> {
    if (!sessionId) return false;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error('[StripeService] STRIPE_SECRET_KEY is not configured; cannot verify a checkout session.');
      return false;
    }

    try {
      const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
        signal: AbortSignal.timeout(10_000),
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
          await this.activateSubscription(userId, planCode, billingCycle, {
            stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
            stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
          });
          return true;
        }
      }
    } catch (err) {
      console.error('[StripeService] Error verifying checkout session:', err);
    }
    return false;
  }

  /**
   * Downgrades a subscription to FREE.
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
   * Resolves the user that owns a Stripe subscription id, so lifecycle events
   * (cancellation, payment failure, dispute) can be attributed without relying
   * on metadata that Stripe does not always propagate.
   */
  static async findUserIdByStripeSubscription(stripeSubscriptionId: string): Promise<string | null> {
    if (!stripeSubscriptionId) return null;
    const res = await query<{ user_id: string }>(
      `SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
      [stripeSubscriptionId]
    );
    return res.rows[0]?.user_id ?? null;
  }

  static async findUserIdByStripeCustomer(stripeCustomerId: string): Promise<string | null> {
    if (!stripeCustomerId) return null;
    const res = await query<{ user_id: string }>(
      `SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1`,
      [stripeCustomerId]
    );
    return res.rows[0]?.user_id ?? null;
  }

  /**
   * Applies a lifecycle status change coming from Stripe to our local row.
   * Returns the affected user id (null when the subscription is unknown).
   */
  static async updateSubscriptionState(
    stripeSubscriptionId: string,
    status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED',
    periodEnd?: string | null
  ): Promise<string | null> {
    if (!stripeSubscriptionId) return null;
    const res = await query<{ user_id: string }>(
      `UPDATE subscriptions
          SET status = $2,
              current_period_end = COALESCE($3::timestamptz, current_period_end)
        WHERE stripe_subscription_id = $1
        RETURNING user_id`,
      [stripeSubscriptionId, status, periodEnd ?? null]
    );
    return res.rows[0]?.user_id ?? null;
  }

  /**
   * Best-effort attribution of a Stripe event object to one of our users, using
   * metadata first and falling back to the stored customer/subscription ids.
   */
  static async resolveUserIdFromStripeObject(obj: any): Promise<string | null> {
    if (!obj) return null;
    if (typeof obj.metadata?.userId === 'string' && obj.metadata.userId) return obj.metadata.userId;
    const subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id;
    if (subId) {
      const bySub = await this.findUserIdByStripeSubscription(subId);
      if (bySub) return bySub;
    }
    const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
    if (customerId) {
      const byCustomer = await this.findUserIdByStripeCustomer(customerId);
      if (byCustomer) return byCustomer;
    }
    return null;
  }

  /**
   * Suspends an account after a chargeback: revokes entitlements AND sessions
   * and API keys so the account cannot keep consuming paid resources.
   */
  static async suspendForDispute(userId: string): Promise<void> {
    await transaction(async (client) => {
      await client.query(
        `UPDATE users SET status = 'SUSPENDED', tier = 'FREE', updated_at = NOW() WHERE id = $1`,
        [userId]
      );
      await client.query(`UPDATE subscriptions SET status = 'CANCELED' WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      await client.query(`UPDATE api_keys SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    });
  }

  /**
   * Verifies a Stripe webhook signature (HMAC-SHA256, `t=` + `v1=` scheme).
   */
  static verifyWebhookSignature(payload: string, header: string, secret: string, maxAgeSec = 300): boolean {
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

      const expected = createHmac('sha256', secret)
        .update(`${timestamp}.${payload}`)
        .digest('hex');

      const expectedBuf = Buffer.from(expected, 'hex');
      const signatureBuf = Buffer.from(signature, 'hex');
      // timingSafeEqual throws on length mismatch, which is itself a rejection.
      if (expectedBuf.length !== signatureBuf.length) return false;
      return timingSafeEqual(signatureBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Webhook idempotency: records an event id exactly once. Returns false when the
   * event has already been processed, so redelivery cannot double-apply effects.
   */
  static async markWebhookEventProcessed(eventId: string, eventType: string): Promise<boolean> {
    if (!eventId) return true;
    const res = await query(
      `INSERT INTO webhook_events (id, event_type) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [eventId, eventType]
    );
    return res.rows.length > 0;
  }

  /**
   * Releases a previously claimed event so Stripe's retry can process it again
   * after a transient failure.
   */
  static async releaseWebhookEvent(eventId: string): Promise<void> {
    if (!eventId) return;
    await query(`DELETE FROM webhook_events WHERE id = $1`, [eventId]);
  }
}
