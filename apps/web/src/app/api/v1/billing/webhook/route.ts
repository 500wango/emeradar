import { NextRequest, NextResponse } from 'next/server';
import {
  StripeService,
  mapStripeSubscriptionStatus,
  invoicePeriodEnd,
  invoiceSubscriptionId,
  subscriptionPeriodEnd,
} from '@emeradar/services';

function toIsoOrNull(epochSeconds: unknown): string | null {
  return typeof epochSeconds === 'number' && Number.isFinite(epochSeconds)
    ? new Date(epochSeconds * 1000).toISOString()
    : null;
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('stripe-signature');

  // Fail-closed: webhook signature verification is mandatory.
  // - If the secret is not configured, refuse to process anything: an unsigned
  //   endpoint must never activate/deactivate subscriptions in any environment.
  // - If the secret is configured, every request must carry a valid signature.
  if (!secret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured; refusing to process webhook.');
    return NextResponse.json({ error: 'Webhook endpoint not configured' }, { status: 500 });
  }
  if (!signatureHeader) {
    console.warn('[Stripe Webhook] Missing stripe-signature header; rejecting.');
    return NextResponse.json({ error: 'Missing webhook signature' }, { status: 400 });
  }
  const isValid = StripeService.verifyWebhookSignature(rawBody, signatureHeader, secret);
  if (!isValid) {
    console.warn('[Stripe Webhook] Invalid signature received; rejecting.');
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  let event: { id?: string; type?: string; data?: { object?: any } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Malformed webhook payload' }, { status: 400 });
  }

  const eventId = typeof event.id === 'string' ? event.id : '';
  const eventType = typeof event.type === 'string' ? event.type : '';
  const object = event.data?.object ?? {};

  if (['charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'].includes(eventType)) {
    try {
      await StripeService.processPaymentEvent(eventId, eventType, object);
      return NextResponse.json({ received: true });
    } catch (error) {
      await StripeService.recordAttributionFailure(eventType,eventId,object).catch(() => undefined);
      console.error('[Stripe Webhook] Payment reconciliation failed:',error);
      return NextResponse.json({ error: 'Webhook processing error' }, { status: 500 });
    }
  }

  // Idempotency: claim the event id before processing. A duplicate delivery is
  // acknowledged without re-applying its effects.
  const claimed = await StripeService.markWebhookEventProcessed(eventId, eventType);
  if (!claimed) {
    console.log(`[Stripe Webhook] Duplicate event ${eventId} (${eventType}) ignored.`);
    return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
  }

  try {
    switch (eventType) {
      case 'checkout.session.completed': {
        const userId = object?.metadata?.userId || object?.client_reference_id;
        const planCode = (object?.metadata?.planCode as 'PRO' | 'TEAM') || 'PRO';
        const billingCycle = object?.metadata?.billingCycle === 'lifetime'
          ? 'lifetime'
          : object?.metadata?.billingCycle === 'yearly'
          ? 'yearly'
          : object?.metadata?.billingCycle === 'quarterly'
          ? 'quarterly'
          : 'monthly';

        // For payment-mode (lifetime) checkouts "completed" can fire before the
        // funds settle, so require a paid payment_status.
        const paid = await StripeService.validatePaidCheckout(object);
        if (userId && paid) {
          await StripeService.activateSubscription(userId, planCode, billingCycle, {
            stripeCustomerId: typeof object?.customer === 'string' ? object.customer : null,
            stripeSubscriptionId: typeof object?.subscription === 'string' ? object.subscription : null,
            // Lifetime checkouts are payment-mode: no Subscription object exists,
            // so the payment intent is the only handle a later dispute or refund
            // can be attributed through.
            stripePaymentIntentId:
              typeof object?.payment_intent === 'string' ? object.payment_intent : null,
          });
          console.log(`[Stripe Webhook] Activated subscription for user ${userId} (${planCode}).`);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const status = mapStripeSubscriptionStatus(object?.status);
        await StripeService.updateSubscriptionState(
          object?.id,
          status,
          toIsoOrNull(subscriptionPeriodEnd(object)),
          typeof object?.cancel_at_period_end === 'boolean' ? object.cancel_at_period_end : null
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const userId =
          (await StripeService.resolveUserIdFromStripeObject(object)) ||
          (typeof object?.metadata?.userId === 'string' ? object.metadata.userId : null);
        if (userId) {
          await StripeService.deactivateSubscription(userId);
          console.log(`[Stripe Webhook] Subscription canceled, downgraded user ${userId} to FREE.`);
        } else {
          // A cancellation we cannot attribute is an account that keeps its paid
          // entitlements indefinitely — worth a durable record, not a log line.
          await StripeService.recordAttributionFailure(eventType, eventId, object);
        }
        break;
      }

      case 'invoice.paid': {
        await StripeService.updateSubscriptionState(
          invoiceSubscriptionId(object) ?? '',
          'ACTIVE',
          toIsoOrNull(invoicePeriodEnd(object))
        );
        break;
      }

      case 'invoice.payment_failed': {
        const userId = await StripeService.updateSubscriptionState(
          invoiceSubscriptionId(object) ?? '',
          'PAST_DUE'
        );
        if (userId) {
          console.warn(`[Stripe Webhook] Payment failed for user ${userId}; subscription marked PAST_DUE.`);
        } else {
          // Unattributed, this is the start of a dunning clock that never runs and
          // a grace window that never ends.
          await StripeService.recordAttributionFailure(eventType, eventId, object);
        }
        break;
      }

      default:
        // Other events are acknowledged but intentionally ignored.
        break;
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err: any) {
    // Release the claim so Stripe's retry can reprocess this event.
    await StripeService.releaseWebhookEvent(eventId).catch(() => undefined);
    console.error('[Stripe Webhook] Processing error:', err);
    // Never echo internal error details to the (unauthenticated) caller.
    return NextResponse.json({ error: 'Webhook processing error' }, { status: 500 });
  }
}
