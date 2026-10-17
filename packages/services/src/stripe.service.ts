import { query, transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readPlanEntitlements, SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { processPaymentEvent } from './stripe-payment.service';

export interface CheckoutSessionOptions {
  userId: string;
  planCode: 'STARTER' | 'PRO' | 'TEAM';
  billingCycle?: 'monthly' | 'yearly' | 'lifetime';
  returnUrl?: string;
}

export interface StripeLinkOptions {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  /**
   * Set for one-time (lifetime) purchases. Stripe creates no Subscription object
   * for payment-mode checkouts, so this is the only handle that later dispute and
   * refund events carry.
   */
  stripePaymentIntentId?: string | null;
  /** When provided (from Stripe), the period end is used verbatim instead of being recomputed. */
  currentPeriodEnd?: string | null;
}


const PLAN_PRICES = {
  STARTER: {
    name: 'Starter',
    monthly: 4900, // $49
    yearly: 47000, // $39.17/mo * 12 = $470 (20% off)
  },
  PRO: {
    name: 'Builder Pro',
    monthly: 7900, // $79
    yearly: 79000, // $65.83/mo * 12 = $790 (17% off)
  },
  TEAM: {
    name: 'Scale Team',
    monthly: 19900, // $199
    yearly: 199000, // $165.83/mo * 12 = $1,990 (17% off)
  },
} as const;

const LIFETIME_AMOUNT_CENTS = 129900; // $1,299 (Founding Legacy, 限量 20 席)
// const STEALTH_LOCK_AMOUNT_CENTS = 29900; // $299 (Phase 1) — 待实现买断功能时启用

/** Phase 1 供给约束（新定价方案 2026-10）：阶梯化席位上限，按需扩容。 */
export const STARTER_SEAT_CAP = 100;
export const PRO_SEAT_CAP = 200; // Phase 1 先开放 50 席
export const TEAM_SEAT_CAP = 30;
export const FOUNDING_SEAT_CAP = 20; // Founding Legacy 限量

/** 终身订阅的 `current_period_end` 哨兵值（见 activateSubscription）。 */
const LIFETIME_PERIOD_END_SQL = `TIMESTAMPTZ '9999-12-31 23:59:59+00'`;

/**
 * Maps a Stripe subscription status onto our local subscription status.
 *
 * Lives here rather than inline in the webhook route so it can be tested: the
 * default branch is the load-bearing one. Stripe has statuses we have no column
 * for (`incomplete`, `paused`, and whatever it adds next), and the fallback keeps
 * a grace period instead of cutting access off on a status we simply do not
 * recognise — but that also means an unknown status silently reads as PAST_DUE,
 * which is worth having a test for.
 */
export function mapStripeSubscriptionStatus(
  stripeStatus: string | undefined
): 'ACTIVE' | 'PAST_DUE' | 'CANCELED' {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'ACTIVE';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'CANCELED';
    default:
      // past_due / incomplete / paused / anything new: keep the grace period.
      return 'PAST_DUE';
  }
}

/**
 * Billing period end carried by a `customer.subscription.*` event object.
 *
 * Stripe API 2025-03-31 ("Basil") removed `current_period_start/end` from the
 * Subscription resource and moved them onto each subscription item. An endpoint
 * created on a current API version therefore sends the period only as
 * `items.data[].current_period_end`; reading the old top-level field alone
 * quietly yields "no period end", and on a renewal that means the paid-through
 * date never moves while the customer is being charged. Both shapes are read, so
 * the endpoint behaves the same on either version. A single-item subscription —
 * which is every subscription this app creates — makes `data[0]` exact.
 */
export function subscriptionPeriodEnd(obj: any): number | null {
  const top = obj?.current_period_end;
  if (typeof top === 'number' && Number.isFinite(top)) return top;
  const item = obj?.items?.data?.[0]?.current_period_end;
  return typeof item === 'number' && Number.isFinite(item) ? item : null;
}

/**
 * Invoice → subscription id.
 *
 * Basil moved `invoice.subscription` to `invoice.parent.subscription_details.subscription`.
 * Reading only the old field makes every renewal event unattributable: the
 * subscription id is null, `updateSubscriptionState` returns early, and
 * `invoice.payment_failed` turns into a 500 that Stripe retries forever while the
 * account never enters PAST_DUE.
 */
export function invoiceSubscriptionId(obj: any): string | null {
  if (typeof obj?.subscription === 'string' && obj.subscription) return obj.subscription;
  const parent = obj?.parent?.subscription_details?.subscription;
  if (typeof parent === 'string' && parent) return parent;
  if (typeof parent?.id === 'string' && parent.id) return parent.id;
  return null;
}

/** Paid-through end of the first invoice line's period (unchanged by Basil). */
export function invoicePeriodEnd(obj: any): number | null {
  const end = obj?.lines?.data?.[0]?.period?.end;
  return typeof end === 'number' && Number.isFinite(end) ? end : null;
}

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
  static async processPaymentEvent(eventId: string, type: string, object: any): Promise<void> {
    const user = await processPaymentEvent(eventId, type, object);
    if (user) await SubscriptionLifecycleService.reconcileAlerts(user);
  }
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

    // 席位上限放在建会话（以及开发模拟激活）之前：满额后不应再让人付款（付完才发现
    // 没座位，就是收了钱无物可交）。竞态下可能略微超卖一两席，阶梯化上限可接受；
    // 严格化需要在 webhook 落账侧再校验，不在本任务范围。
    const seatCapByPlan: Record<string, { recurring: number; lifetime: number }> = {
      STARTER: { recurring: STARTER_SEAT_CAP, lifetime: 0 },
      PRO: { recurring: PRO_SEAT_CAP, lifetime: FOUNDING_SEAT_CAP },
      TEAM: { recurring: TEAM_SEAT_CAP, lifetime: 0 },
    };

    const cap = seatCapByPlan[planCode];
    if (cap) {
      const seats = await query<{ lifetime: number; recurring: number }>(
        `SELECT COUNT(*) FILTER (WHERE current_period_end = ${LIFETIME_PERIOD_END_SQL})::int AS lifetime,
                COUNT(*) FILTER (WHERE current_period_end <> ${LIFETIME_PERIOD_END_SQL})::int AS recurring
           FROM subscriptions
          WHERE plan_code = $1 AND status = 'ACTIVE' AND current_period_end > NOW()`,
        [planCode]
      );
      const lifetimeSeats = seats.rows[0]?.lifetime ?? 0;
      const recurringSeats = seats.rows[0]?.recurring ?? 0;

      if (isLifetime && planCode === 'PRO' && lifetimeSeats >= cap.lifetime) {
        throw new EmeradarError(
          ErrorCode.SEATS_FULL,
          `Founding Lifetime is sold out (${cap.lifetime} seats). Join the waitlist or choose a monthly or yearly plan.`,
          409,
          { details: { cap: cap.lifetime, waitlist: true } }
        );
      }
      if (!isLifetime && recurringSeats >= cap.recurring) {
        throw new EmeradarError(
          ErrorCode.SEATS_FULL,
          `${config.name} seats are full during Phase 1 (${cap.recurring}). Join the waitlist or upgrade to a higher tier.`,
          409,
          { details: { cap: cap.recurring, waitlist: true } }
        );
      }
    }

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

    // Reuse the Stripe customer we already know, so lifecycle webhooks land on an
    // object we can attribute. Stripe rejects a request carrying both `customer`
    // and `customer_email`, so it is one or the other:
    //   - known customer → pass `customer`
    //   - first purchase  → pass `customer_email`, and Stripe creates the customer.
    //     We store the id it returns at activation, so every later checkout (plan
    //     change, renewal, second purchase) takes the first branch.
    // The alternative — creating a Customer up front — would need somewhere to
    // persist an id for a user who has no subscription row yet, i.e. a
    // placeholder row that looks like a subscription. Not worth it for the same
    // eventual attribution.
    const customerRes = await query<{ stripe_customer_id: string | null }>(
      `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1`,
      [userId]
    );
    const knownCustomerId = customerRes.rows[0]?.stripe_customer_id ?? null;

    const form = new URLSearchParams();
    form.append('mode', isLifetime ? 'payment' : 'subscription');
    form.append('payment_method_types[]', 'card');
    form.append('client_reference_id', userId);
    if (knownCustomerId) {
      form.append('customer', knownCustomerId);
    } else {
      form.append('customer_email', user.email);
    }
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

    await query(
      `INSERT INTO stripe_checkout_intents (id, user_id, plan_code, billing_cycle, amount_cents, currency, mode)
       VALUES ($1, $2, $3, $4, $5, 'usd', $6)`,
      [data.id, userId, planCode, billingCycle, amountCents, isLifetime ? 'payment' : 'subscription']
    );
    return {
      url: data.url,
      sessionId: data.id,
    };
  }

  /**
   * A one-time Checkout Session for a Stealth Lock buyout (Epic 1.14、10 §4.5b).
   *
   * Deliberately **not** built on `createCheckoutSession`, and deliberately not
   * recorded in `stripe_checkout_intents`. That table's `plan_code` is
   * `NOT NULL REFERENCES plans(code)`, and a buyout is not a plan (13 §3.1):
   * forcing it in would give the question "which of this money is subscription
   * revenue" a second, disagreeing answer. The authoritative record of the sale
   * is the `stealth_locks` row the caller already wrote.
   *
   * `metadata` is set on the **Session** as well as mirrored onto the PaymentIntent.
   * The comment on `createCheckoutSession` explains the mirroring direction
   * ("session metadata is not copied onto the objects Stripe creates"); the
   * converse matters just as much here, because `checkout.session.completed`
   * hands us the *Session* — dispatch on `payment_intent_data` metadata alone and
   * the branch never fires, the event falls through to the subscription handler,
   * and the buyer's $199 activates nothing while Stripe retries forever.
   */
  static async createStealthLockCheckout(opts: {
    userId: string;
    opportunityId: string;
    stealthLockId: string;
    amountCents: number;
    returnUrl?: string;
    expiresInMinutes: number;
  }): Promise<{ url: string; sessionId: string; expiresAt: Date; mock: boolean }> {
    const userRes = await query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = $1`,
      [opts.userId]
    );
    if (userRes.rows.length === 0) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, 'User not found.', 404);
    }
    const user = userRes.rows[0];
    const returnUrl = safeReturnUrl(opts.returnUrl);
    const expiresAt = new Date(Date.now() + opts.expiresInMinutes * 60_000);

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      // Same fail-closed rule as subscriptions: never grant a paid good because a
      // secret is missing. The dev simulation is only reachable outside production.
      if (isProduction()) {
        console.error('[StripeService] STRIPE_SECRET_KEY is not configured; refusing a buyout checkout.');
        throw new EmeradarError(
          ErrorCode.INTERNAL,
          'Billing is temporarily unavailable. Please try again later.',
          503
        );
      }
      console.warn('[StripeService] STRIPE_SECRET_KEY not set (non-production). Running dev mock buyout.');
      return {
        url: `${returnUrl}?stealth_lock_session=mock_${opts.stealthLockId}`,
        sessionId: `mock_sl_sess_${opts.stealthLockId}`,
        expiresAt,
        mock: true,
      };
    }

    const customerRes = await query<{ stripe_customer_id: string | null }>(
      `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1`,
      [opts.userId]
    );
    const knownCustomerId = customerRes.rows[0]?.stripe_customer_id ?? null;

    const form = new URLSearchParams();
    form.append('mode', 'payment');
    // Pinned for the same reason the subscription path pins it: with dynamic
    // payment methods, `checkout.session.completed` also fires for async methods
    // whose funds have not settled, and the lock would then be marked paid on a
    // promise. Card-only keeps "completed" and "paid" the same statement.
    form.append('payment_method_types[]', 'card');
    form.append('client_reference_id', opts.userId);
    if (knownCustomerId) {
      form.append('customer', knownCustomerId);
    } else {
      form.append('customer_email', user.email);
    }
    form.append('line_items[0][price_data][currency]', 'usd');
    form.append('line_items[0][price_data][product_data][name]', 'Emeradar Stealth Buyout');
    form.append('line_items[0][price_data][unit_amount]', String(opts.amountCents));
    form.append('line_items[0][quantity]', '1');
    form.append('expires_at', String(Math.floor(expiresAt.getTime() / 1000)));
    form.append('success_url', `${returnUrl}?stealth_lock=success`);
    form.append('cancel_url', `${returnUrl}?stealth_lock=canceled`);
    form.append('metadata[purchaseKind]', 'STEALTH_BUYOUT');
    form.append('metadata[userId]', opts.userId);
    form.append('metadata[opportunityId]', opts.opportunityId);
    form.append('metadata[stealthLockId]', opts.stealthLockId);
    form.append('payment_intent_data[metadata][purchaseKind]', 'STEALTH_BUYOUT');
    form.append('payment_intent_data[metadata][userId]', opts.userId);
    form.append('payment_intent_data[metadata][opportunityId]', opts.opportunityId);
    form.append('payment_intent_data[metadata][stealthLockId]', opts.stealthLockId);

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
        res.status || 500,
      );
    }
    return { url: data.url, sessionId: data.id, expiresAt, mock: false };
  }

  /**
   * Whether a Checkout Session has actually been paid.
   *
   * Used by the void sweep before it writes a reservation off. The sweep must not
   * infer "unpaid" from the clock: a payment completed just before the session
   * expired whose webhook is late would then be voided, i.e. money captured with
   * nothing delivered — the precise outcome the reservation design exists to
   * avoid (03 §17 I15). `null` (a reservation whose session never got created)
   * is unambiguously unpaid.
   */
  static async isCheckoutSessionPaid(sessionId: string | null): Promise<boolean> {
    if (!sessionId) return false;
    if (sessionId.startsWith('mock_')) return false;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return false;
    try {
      const res = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
        {
          headers: { Authorization: `Bearer ${stripeKey}` },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!res.ok) return false;
      const session: any = await res.json();
      return session?.payment_status === 'paid';
    } catch {
      // A lookup failure must not authorize a void: "could not tell" is not
      // "unpaid" when the wrong guess costs someone their purchase.
      return true;
    }
  }

  /** The lock a refunded/disputed PaymentIntent bought, if any (13 §4.3). */
  static async findStealthLockByPaymentIntent(paymentIntentId: string): Promise<string | null> {
    const res = await query<{ id: string }>(
      `SELECT id FROM stealth_locks WHERE provider_payment_id = $1 LIMIT 1`,
      [paymentIntentId]
    );
    return res.rows[0]?.id ?? null;
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
      await client.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`, [userId]);
      const purchaseId = link.stripeSubscriptionId ? `subscription:${link.stripeSubscriptionId}`
        : link.stripePaymentIntentId ? `payment:${link.stripePaymentIntentId}` : null;
      if (purchaseId) {
        const existing = await client.query(`SELECT id,user_id FROM stripe_purchases WHERE
          stripe_subscription_id=$1 OR stripe_payment_intent_id=$2`,
          [link.stripeSubscriptionId ?? null,link.stripePaymentIntentId ?? null]);
        // A replay of an old checkout must never revive a refunded/canceled purchase
        // or overwrite a newer grant. The first activation and history commit together.
        if (existing.rows.length) {
          if (existing.rows.length !== 1 || existing.rows[0].user_id !== userId) throw new Error('Purchase ownership conflict');
          return;
        }
        await client.query(`INSERT INTO stripe_purchases(id,user_id,stripe_subscription_id,stripe_payment_intent_id)
          VALUES($1,$2,$3,$4)`,[purchaseId,userId,link.stripeSubscriptionId ?? null,link.stripePaymentIntentId ?? null]);
      }
      // `users.tier` is written here because this is a lifecycle writer: since the
      // entitlement reader stopped consulting it, the column is a **display
      // mirror of this table**, and the writers that decide a subscription are the
      // only ones that may set it. See the tier-normalization block in
      // packages/db/src/schema.sql.
      await client.query(
        `UPDATE users SET tier = $2, updated_at = NOW() WHERE id = $1`,
        [userId, planCode]
      );

      // Snapshot the plan catalog into the subscription (docs/13 §3.3): an
      // operator editing a plan must not retroactively change what an existing
      // subscriber is entitled to within the current period. Nothing wrote this
      // column before — which is why the reader had to fall back to the live
      // catalog, and why a partial snapshot (one key) could shadow the whole
      // catalog.
      const snapshot = await readPlanEntitlements(client, planCode);

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
          entitlements_snapshot, cancel_at_period_end,
          stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, stripe_purchase_id
        ) VALUES (
          $1, $2, $3, 'ACTIVE', NOW(), ${periodEndSql},
          $8::jsonb, false, $6, $7, $9, $10
        )
        ON CONFLICT (user_id) DO UPDATE SET
          plan_code = EXCLUDED.plan_code,
          status = 'ACTIVE',
          -- current_period_start is deliberately NOT refreshed. This method is
          -- called from the checkout success page via verifyAndActivateSession,
          -- which re-runs on every reload of the same session; moving the anchor
          -- would silently reset the quota window B3 aligns to. Idempotent by
          -- design means re-activating the same subscription changes nothing the
          -- user can observe.
          current_period_end = EXCLUDED.current_period_end,
          entitlements_snapshot = EXCLUDED.entitlements_snapshot,
          -- A fresh activation is by definition not a pending cancellation.
          cancel_at_period_end = false,
          past_due_since = NULL,
          stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
          stripe_purchase_id = EXCLUDED.stripe_purchase_id,
          payment_hold_purchase_id = NULL, payment_hold_prior_status = NULL`,
        [
          subId,
          userId,
          planCode,
          billingCycle,
          link.currentPeriodEnd ?? null,
          link.stripeCustomerId ?? null,
          link.stripeSubscriptionId ?? null,
          JSON.stringify(snapshot ?? {}),
          link.stripePaymentIntentId ?? null,
          purchaseId,
        ]
      );
    });

    // A re-subscribe must also give back the alert rules the downgrade took away —
    // but only those; rules the user turned off themselves stay off (see
    // reconcileAlerts).
    await SubscriptionLifecycleService.reconcileAlerts(userId);
  }

  /**
   * Verifies a completed checkout session and ensures the subscription is active.
   *
   * Fails closed: an unconfigured Stripe key or an unverifiable session never
   * results in entitlements being granted.
   */
  static async validatePaidCheckout(session: any): Promise<boolean> {
    if (session?.payment_status !== 'paid' || typeof session.id !== 'string') return false;
    const result = await query<{
      user_id: string; plan_code: string; billing_cycle: string;
      amount_cents: number; currency: string; mode: string;
    }>(`SELECT user_id, plan_code, billing_cycle, amount_cents, currency, mode
        FROM stripe_checkout_intents WHERE id = $1`, [session.id]);
    const intent = result.rows[0];
    if (!intent) {
      await this.recoverLegacyCheckoutIntent(session);
      return this.validatePaidCheckout(session);
    }
    return session.mode === intent.mode && session.amount_total === intent.amount_cents
      && session.currency === intent.currency
      && session.metadata?.userId === intent.user_id
      && session.metadata?.planCode === intent.plan_code
      && session.metadata?.billingCycle === intent.billing_cycle
      && (!session.client_reference_id || session.client_reference_id === intent.user_id)
      && (intent.mode === 'payment'
        ? typeof session.payment_intent === 'string' && Boolean(session.payment_intent)
        : typeof session.subscription === 'string' && Boolean(session.subscription));
  }

  /** Recover pre-migration sessions from Stripe, never from unverified metadata alone. */
  private static async recoverLegacyCheckoutIntent(session: any): Promise<void> {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('Checkout requires reconciliation: Stripe is not configured');
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session.id)}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Checkout requires reconciliation: Stripe lookup failed');
    const authoritative = await response.json();
    const plan = authoritative.metadata?.planCode;
    const cycle = authoritative.metadata?.billingCycle;
    const userId = authoritative.metadata?.userId;
    const validPlan = plan === 'PRO' || plan === 'TEAM';
    const validCycle = cycle === 'monthly' || cycle === 'yearly' || cycle === 'lifetime';
    const expectedAmount = validPlan && validCycle
      ? cycle === 'lifetime' ? LIFETIME_AMOUNT_CENTS : PLAN_PRICES[plan as keyof typeof PLAN_PRICES][cycle as 'monthly' | 'yearly']
      : null;
    if (!validPlan || !validCycle || typeof userId !== 'string' || !userId
      || authoritative.id !== session.id || authoritative.status !== 'complete'
      || authoritative.payment_status !== 'paid' || authoritative.currency !== 'usd'
      || authoritative.amount_total !== expectedAmount
      || authoritative.mode !== (cycle === 'lifetime' ? 'payment' : 'subscription')
      || (authoritative.client_reference_id && authoritative.client_reference_id !== userId)
      || session.metadata?.userId !== userId || session.metadata?.planCode !== plan
      || session.metadata?.billingCycle !== cycle || session.amount_total !== authoritative.amount_total
      || session.mode !== authoritative.mode || session.currency !== authoritative.currency
      || session.payment_intent !== authoritative.payment_intent || session.subscription !== authoritative.subscription) {
      throw new Error('Checkout requires reconciliation: authoritative session does not match the supported contract');
    }
    await query(
      `INSERT INTO stripe_checkout_intents (id, user_id, plan_code, billing_cycle, amount_cents, currency, mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [authoritative.id, userId, plan, cycle, authoritative.amount_total, authoritative.currency, authoritative.mode]
    );
  }

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
      if (await this.validatePaidCheckout(session)) {
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
            // Present on payment-mode (lifetime) sessions; null for subscriptions.
            stripePaymentIntentId:
              typeof session.payment_intent === 'string' ? session.payment_intent : null,
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
        `UPDATE subscriptions SET status = 'CANCELED', cancel_at_period_end = false WHERE user_id = $1`,
        [userId]
      );
    });

    // Downgrading used to leave the alert rules behind: the account fell to FREE's
    // one-rule allowance while twenty rules kept evaluating and mailing. The
    // cascade caps them; `disabled_reason` is what makes the cap reversible
    // without resurrecting rules the user had switched off.
    await SubscriptionLifecycleService.reconcileAlerts(userId);
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
   * Lifetime purchases create no Subscription object, so the payment intent is the
   * only thing a refund or dispute carries that we can look up locally.
   */
  static async findUserIdByStripePaymentIntent(stripePaymentIntentId: string): Promise<string | null> {
    if (!stripePaymentIntentId) return null;
    const res = await query<{ user_id: string }>(
      `SELECT user_id FROM subscriptions WHERE stripe_payment_intent_id = $1 LIMIT 1`,
      [stripePaymentIntentId]
    );
    return res.rows[0]?.user_id ?? null;
  }

  /**
   * Last resort: walk a charge id back to a user through Stripe.
   *
   * Dispute events can arrive with only `charge` populated (and the `invoice` is
   * not embedded, so `subscription` is not on the object). One expanded GET
   * recovers the chain: charge → payment_intent (lifetime) or charge → invoice →
   * subscription → user. It costs one API call, and only on the events where
   * attribution has already failed everywhere else — disputes and refunds, which
   * is exactly where silently losing the user means giving away entitlements.
   */
  static async findUserIdByStripeCharge(stripeChargeId: string): Promise<string | null> {
    if (!stripeChargeId) return null;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error('[StripeService] Cannot resolve a charge without STRIPE_SECRET_KEY.');
      return null;
    }
    try {
      const res = await fetch(
        `https://api.stripe.com/v1/charges/${encodeURIComponent(stripeChargeId)}?expand[]=invoice`,
        { headers: { Authorization: `Bearer ${stripeKey}` }, signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) {
        console.error(`[StripeService] Charge lookup for ${stripeChargeId} returned ${res.status}.`);
        return null;
      }
      const charge = await res.json();

      const paymentIntentId =
        typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (paymentIntentId) {
        const byPaymentIntent = await this.findUserIdByStripePaymentIntent(paymentIntentId);
        if (byPaymentIntent) return byPaymentIntent;
      }

      const invoice = charge.invoice;
      const subscriptionId = invoiceSubscriptionId(invoice);
      if (subscriptionId) return this.findUserIdByStripeSubscription(subscriptionId);
    } catch (error) {
      console.error(`[StripeService] Charge lookup for ${stripeChargeId} failed:`, error);
    }
    return null;
  }

  /**
   * Applies a lifecycle status change coming from Stripe to our local row, and
   * returns the affected user id (null when the subscription is unknown).
   *
   * This is the single choke point for webhook-driven status changes. It used to
   * touch the subscription row only, while `users.tier` kept saying PRO — and
   * since the entitlement reader consulted `tier`, a cancelled or past-due
   * account kept every paid entitlement. The tier mirror is therefore maintained
   * here, in the same statement, and the read side no longer needs to guess.
   */
  static async updateSubscriptionState(
    stripeSubscriptionId: string,
    status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED',
    periodEnd?: string | null,
    cancelAtPeriodEnd?: boolean | null,
    transactionClient?: { query: typeof query }
  ): Promise<string | null> {
    if (!stripeSubscriptionId) return null;

    const apply = async (client: { query: typeof query }) => {
      const res = await client.query<{ user_id: string; plan_code: string }>(
        `UPDATE subscriptions
            SET status = $2,
                current_period_end = COALESCE($3::timestamptz, current_period_end),
                -- Dunning starts at the first failure and is never re-based by a
                -- later one: restamping it on every retry would make the 7-day
                -- grace period restart indefinitely. Cleared on recovery.
                past_due_since = CASE
                  WHEN $2 = 'PAST_DUE' THEN COALESCE(past_due_since, NOW())
                  ELSE NULL
                END,
                cancel_at_period_end = COALESCE($4::boolean, cancel_at_period_end)
          WHERE stripe_subscription_id = $1
          RETURNING user_id, plan_code`,
        [stripeSubscriptionId, status, periodEnd ?? null, cancelAtPeriodEnd ?? null]
      );

      const row = res.rows[0];
      if (!row) return null;

      // The mirror follows the subscription: PAST_DUE keeps the paid tier during
      // the grace window (the read side is what enforces the window's end), and
      // CANCELED drops it. Writing FREE on CANCELED is what makes the display
      // agree with the (now fail-closed) entitlement reader.
      await client.query(`UPDATE users SET tier = $2, updated_at = NOW() WHERE id = $1`, [
        row.user_id,
        status === 'CANCELED' ? 'FREE' : row.plan_code,
      ]);

      return row.user_id;
    };
    const affectedUserId = transactionClient ? await apply(transactionClient) : await transaction(apply);

    // Same cascade as an explicit cancellation: a subscription Stripe reports as
    // canceled is a downgrade whichever endpoint heard about it.
    if (affectedUserId && status === 'CANCELED' && !transactionClient) {
      await SubscriptionLifecycleService.reconcileAlerts(affectedUserId);
    }

    return affectedUserId;
  }

  /**
   * Best-effort attribution of a Stripe event object to one of our users.
   *
   * Ordered cheapest-and-most-reliable first: metadata we set ourselves, then the
   * subscription, then the payment intent (the lifetime path), then — one API call
   * — the charge, whose expanded invoice carries the subscription. Dispute and
   * refund objects are the ones that reach the last step.
   */
  static async resolveUserIdFromStripeObject(obj: any): Promise<string | null> {
    if (!obj) return null;
    if (typeof obj.metadata?.userId === 'string' && obj.metadata.userId) return obj.metadata.userId;

    const subId = invoiceSubscriptionId(obj);
    if (subId) {
      const bySub = await this.findUserIdByStripeSubscription(subId);
      if (bySub) return bySub;
    }

    const paymentIntentId =
      typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id;
    if (paymentIntentId) {
      const byPaymentIntent = await this.findUserIdByStripePaymentIntent(paymentIntentId);
      if (byPaymentIntent) return byPaymentIntent;
    }

    const chargeId = typeof obj.charge === 'string' ? obj.charge : obj.charge?.id;
    if (chargeId) {
      const byCharge = await this.findUserIdByStripeCharge(chargeId);
      if (byCharge) return byCharge;
    }

    const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
    if (customerId) {
      const byCustomer = await this.findUserIdByStripeCustomer(customerId);
      if (byCustomer) return byCustomer;
    }
    return null;
  }

  /**
   * Records an attribution failure where an operator can actually find it.
   *
   * Keep a durable audit record before failing the webhook. The route releases
   * its claim and responds 500, allowing Stripe to retry transient attribution
   * failures rather than permanently acknowledging an unapplied event.
   */
  static async recordAttributionFailure(eventType: string, eventId: string, obj: any): Promise<void> {
    if (eventId && typeof obj?.id === 'string') {
      await query(
        `INSERT INTO stripe_event_retries (event_id, event_type, object_id)
         VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING`,
        [eventId, eventType, obj.id]
      );
    }
    console.error(
      `[StripeService] ${eventType} (${eventId}) could not be attributed to a user; ` +
        'entitlements were NOT revoked. Inspect audit_log for action = stripe.attribution_failed.'
    );
    try {
      await query(
        `INSERT INTO audit_log (id, actor_id, actor_type, action, target_type, target_id, payload)
         VALUES ($1, NULL, 'SYSTEM', 'stripe.attribution_failed', 'STRIPE_EVENT', $2, $3::jsonb)`,
        [
          `aud_${randomUUID()}`,
          eventId || eventType,
          JSON.stringify({
            eventType,
            eventId,
            objectId: typeof obj?.id === 'string' ? obj.id : null,
            customer: typeof obj?.customer === 'string' ? obj.customer : null,
            subscription: typeof obj?.subscription === 'string' ? obj.subscription : null,
            paymentIntent:
              typeof obj?.payment_intent === 'string' ? obj.payment_intent : (obj?.payment_intent?.id ?? null),
            charge: typeof obj?.charge === 'string' ? obj.charge : (obj?.charge?.id ?? null),
          }),
        ]
      );
    } catch (error) {
      // Never let the audit write turn a handled event into a 500.
      console.error('[StripeService] Failed to record the attribution failure:', error);
    }
    throw new Error('Unresolved Stripe attribution; retry required');
  }

  /**
   * Lifts a dispute suspension when the bank sides with us.
   *
   * `suspendForDispute` cancels the subscription row, but it does not touch
   * `current_period_end` — so the paid-through date survives and is what decides
   * whether the account comes back as ACTIVE (still inside the paid period) or
   * PAST_DUE (period already over). Reinstating on a date we still hold is the
   * difference between a customer who won their chargeback keeping what they paid
   * for, and being silently cut off.
   *
   * A row the user had already flagged for cancellation is left cancelled: the
   * dispute does not undo their own decision.
   */
  static async releaseDisputeSuspension(userId: string): Promise<void> {
    await transaction(async (client) => {
      await client.query(
        `UPDATE users SET status = 'ACTIVE', updated_at = NOW()
          WHERE id = $1 AND status = 'SUSPENDED'`,
        [userId]
      );
      await client.query(
        `UPDATE subscriptions
            SET status = CASE WHEN current_period_end > NOW() THEN 'ACTIVE' ELSE 'PAST_DUE' END
          WHERE user_id = $1 AND status = 'CANCELED' AND cancel_at_period_end = false`,
        [userId]
      );
      // Mirror follows the subscription again.
      await client.query(
        `UPDATE users u SET tier = s.plan_code, updated_at = NOW()
           FROM subscriptions s
          WHERE u.id = $1 AND s.user_id = u.id AND s.status IN ('ACTIVE','PAST_DUE')`,
        [userId]
      );
    });

    await SubscriptionLifecycleService.reconcileAlerts(userId);
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
