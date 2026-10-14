import { query, transaction } from '@emeradar/db';
import { voidStealthLockByPaymentIntent } from './stealth-lock-policy';

type Client = { query: typeof query };
const idOf = (value: any): string | null => typeof value === 'string' ? value : value?.id ?? null;
export const isPaymentEvent = (type: string) => ['charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'].includes(type);

async function stripeGet(path: string): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe is not configured');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Stripe lookup HTTP ${response.status}`);
  return response.json();
}

/** Always re-read current payment state, including on the HTTP path. Never infer
 * a purchase from customer/metadata, and never change account suspension state. */
export async function applyPaymentEvent(client: Client, type: string, object: any): Promise<string> {
  let dispute: any;
  let chargeId = object.id;
  if (type !== 'charge.refunded') {
    dispute = await stripeGet(`disputes/${encodeURIComponent(object.id)}`);
    if (dispute.id !== object.id) throw new Error('Dispute identity mismatch');
    chargeId = idOf(dispute.charge);
  }
  if (!chargeId) throw new Error('Missing charge attribution');
  const charge = await stripeGet(`charges/${encodeURIComponent(chargeId)}?expand[]=invoice`);
  if (charge.id !== chargeId) throw new Error('Charge identity mismatch');
  let invoice = charge.invoice;
  if (typeof invoice === 'string') invoice = await stripeGet(`invoices/${encodeURIComponent(invoice)}`);
  const pi = idOf(charge.payment_intent);
  const sub = idOf(invoice?.subscription) ?? idOf(invoice?.parent?.subscription_details?.subscription);
  const purchases = await client.query<{ id: string; user_id: string; refunded: boolean }>(
    `SELECT id,user_id,refunded FROM stripe_purchases
     WHERE ($1::text IS NOT NULL AND stripe_payment_intent_id=$1)
        OR ($2::text IS NOT NULL AND stripe_subscription_id=$2)`, [pi,sub]);
  if (purchases.rows.length !== 1) throw new Error('Payment attribution unresolved');
  const purchase = purchases.rows[0];
  // Same lock order as activation; serialization prevents a delayed event from
  // changing a replacement purchase while activation is in flight.
  await client.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`,[purchase.user_id]);
  const current = await client.query<any>(`SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE`,[purchase.user_id]);
  if (!Number.isSafeInteger(charge.amount) || charge.amount <= 0
    || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0
    || charge.amount_refunded > charge.amount) throw new Error('Invalid charge refund amounts');
  if (charge.amount_refunded === charge.amount) {
    await client.query(`UPDATE stripe_purchases SET refunded=true WHERE id=$1`,[purchase.id]);
    purchase.refunded = true;
  }
  if (dispute) {
    if (!['warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost'].includes(dispute.status)) {
      throw new Error('Unknown dispute status');
    }
    await client.query(`INSERT INTO stripe_payment_disputes(id,purchase_id,status) VALUES($1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,updated_at=NOW()
      WHERE stripe_payment_disputes.purchase_id=EXCLUDED.purchase_id
        AND stripe_payment_disputes.status NOT IN ('won','lost','warning_closed')`,[dispute.id,purchase.id,dispute.status]);
  }
  const holds = await client.query(`SELECT id FROM stripe_payment_disputes WHERE purchase_id=$1 AND status NOT IN ('won','warning_closed')`,[purchase.id]);
  const blocked = purchase.refunded || holds.rows.length > 0;

  /**
   * 买断的退款/拒付后果：作废该锁（13 §4.3）。
   *
   * 这一行**必须先于下面那段订阅状态处理**，因为买断不是订阅：它没有
   * `stripe_subscription_id`，`subscriptions.stripe_purchase_id` 也永远不会指向它，
   * 于是那段代码会在 `s.stripe_purchase_id !== purchase.id` 处提前 return。放在后面
   * 就永远执行不到——而后果是"付了钱的人退了款，60 天独占照旧"，即买断变成一条
   * 付不付钱都行的路径。
   *
   * 判据是 `pi` 本身而不看别的字段：`stealth_locks.provider_payment_id` 就是那一笔
   * PaymentIntent，退回哪一笔作废哪一把，不需要也不应该猜。
   */
  if (blocked && pi) {
    await voidStealthLockByPaymentIntent(
      client,
      pi,
      purchase.refunded ? 'PAYMENT_REFUNDED' : 'PAYMENT_DISPUTED'
    );
  }

  const s = current.rows[0];
  if (!s || s.stripe_purchase_id !== purchase.id) return purchase.user_id;
  if (blocked && s.status !== 'CANCELED') {
    await client.query(`UPDATE subscriptions SET payment_hold_purchase_id=$2,payment_hold_prior_status=status,status='CANCELED'
      WHERE user_id=$1`,[purchase.user_id,purchase.id]);
    await client.query(`UPDATE users SET tier='FREE',updated_at=NOW() WHERE id=$1`,[purchase.user_id]);
  } else if (!blocked && s.payment_hold_purchase_id === purchase.id) {
    // Do not invent a new grace period, reverse a cancellation, or revive expiry.
    await client.query(`UPDATE subscriptions SET status=CASE WHEN current_period_end>NOW() AND NOT cancel_at_period_end
        THEN payment_hold_prior_status ELSE 'CANCELED' END,
      payment_hold_purchase_id=NULL,payment_hold_prior_status=NULL WHERE user_id=$1`,[purchase.user_id]);
    await client.query(`UPDATE users u SET tier=CASE WHEN s.status IN ('ACTIVE','PAST_DUE') THEN s.plan_code ELSE 'FREE' END,
      updated_at=NOW() FROM subscriptions s WHERE u.id=$1 AND s.user_id=u.id`,[purchase.user_id]);
  }
  return purchase.user_id;
}

export async function processPaymentEvent(eventId: string, type: string, object: any): Promise<string | null> {
  if (!eventId || !isPaymentEvent(type)) throw new Error('Invalid payment event');
  return transaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[eventId]);
    const previous = await client.query(`SELECT completed_at FROM webhook_events WHERE id=$1`,[eventId]);
    if (previous.rows[0]?.completed_at) return null;
    const user = await applyPaymentEvent(client,type,object);
    await client.query(`INSERT INTO webhook_events(id,event_type,completed_at) VALUES($1,$2,NOW())
      ON CONFLICT(id) DO UPDATE SET completed_at=NOW()`,[eventId,type]);
    return user;
  });
}
