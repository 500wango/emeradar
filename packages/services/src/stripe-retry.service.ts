import { transaction } from '@emeradar/db';
import { StripeService, invoiceSubscriptionId } from './stripe.service';
import { applyPaymentEvent, isPaymentEvent } from './stripe-payment.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

/** Re-read the signed event from Stripe; never store full customer/payment payloads. */
export async function retryStripeAttributions(limit = 20): Promise<{ completed: number; failed: number }> {
  let completed = 0;
  let failed = 0;
  const reconcile = new Set<string>();
  for (let i = 0; i < Math.min(Math.max(limit, 0), 100); i++) {
    const handled = await transaction(async client => {
      const selected = await client.query<{ event_id: string; event_type: string; object_id: string; attempts: number }>(
        `SELECT event_id, event_type, object_id, attempts FROM stripe_event_retries
         WHERE status = 'PENDING' AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at, event_id FOR UPDATE SKIP LOCKED LIMIT 1`
      );
      const row = selected.rows[0];
      if (!row) return false;
      let canceledUser: string | null = null;
      await client.query('SAVEPOINT apply_event');
      try {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) throw new Error('Stripe is not configured');
        const response = await fetch(`https://api.stripe.com/v1/events/${encodeURIComponent(row.event_id)}`, {
          headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`Stripe event lookup HTTP ${response.status}`);
        const event = await response.json();
        if (event.id !== row.event_id || event.type !== row.event_type || event.data?.object?.id !== row.object_id) {
          throw new Error('Stripe event identity mismatch');
        }
        const object = event.data.object;
        // An event successfully handled by the HTTP path needs no replay.
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[row.event_id]);
        const applied = await client.query(`SELECT id FROM webhook_events WHERE id = $1 AND completed_at IS NOT NULL`, [row.event_id]);
        if (!applied.rows.length) {
          // Replaying a stale cancellation against a user's new subscription is
          // unsafe. Resolve only matching identifiers, and do not infer ownership
          // from the customer ID or metadata on this delayed path.
          const subscriptionId = row.event_type === 'customer.subscription.deleted'
            ? object.id : invoiceSubscriptionId(object) ?? object.subscription;
          if (isPaymentEvent(row.event_type)) {
            canceledUser = await applyPaymentEvent(client,row.event_type,object);
          } else if (row.event_type === 'invoice.payment_failed') {
            // Inspect current subscription state rather than replaying an old
            // failure that may since have been paid.
            if (typeof subscriptionId !== 'string') throw new Error('Missing subscription attribution');
            const subResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
              headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
            });
            if (!subResponse.ok) throw new Error(`Stripe subscription lookup HTTP ${subResponse.status}`);
            const sub = await subResponse.json();
            if (sub.id !== subscriptionId) throw new Error('Subscription identity mismatch');
            if (sub.status !== 'past_due') throw new Error('Subscription state changed; manual reconciliation required');
            const user = await StripeService.updateSubscriptionState(subscriptionId, 'PAST_DUE', null, null, client);
            if (!user) throw new Error('Subscription attribution unresolved');
          } else if (row.event_type === 'customer.subscription.deleted') {
            const user = await StripeService.updateSubscriptionState(object.id, 'CANCELED', null, null, client);
            if (!user) throw new Error('Subscription attribution unresolved');
            canceledUser = user;
          } else {
            // Disputes/refunds need a payment-history ownership model to safely
            // revoke a specific purchase after later upgrades. Do not blindly
            // revoke or unsuspend a user's current account from an old event.
            throw new Error('Payment event requires manual reconciliation');
          }
          await client.query(`INSERT INTO webhook_events (id, event_type, completed_at) VALUES ($1, $2, NOW())
            ON CONFLICT (id) DO UPDATE SET completed_at=NOW()`, [row.event_id, row.event_type]);
        }
        await client.query(`UPDATE stripe_event_retries SET status = 'DONE', last_error = NULL WHERE event_id = $1`, [row.event_id]);
        if (canceledUser) reconcile.add(canceledUser);
        completed++;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT apply_event');
        const message = error instanceof Error ? error.message : String(error);
        const terminal = row.attempts + 1 >= 12 || message.includes('manual reconciliation');
        await client.query(
          `UPDATE stripe_event_retries SET attempts = attempts + 1,
           status = $2, last_error = $3, next_attempt_at = NOW() + INTERVAL '1 hour'
           WHERE event_id = $1`, [row.event_id, terminal ? 'FAILED' : 'PENDING', message]
        );
        if (terminal) failed++;
      }
      return true;
    });
    if (!handled) break;
  }
  for (const user of reconcile) await SubscriptionLifecycleService.reconcileAlerts(user);
  return { completed, failed };
}
