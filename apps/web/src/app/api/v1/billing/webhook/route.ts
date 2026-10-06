import { NextRequest, NextResponse } from 'next/server';
import { StripeService } from '@emeradar/services';

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

  try {
    const event = JSON.parse(rawBody);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data?.object;
        const userId = session?.metadata?.userId || session?.client_reference_id;
        const planCode = (session?.metadata?.planCode as 'PRO' | 'TEAM') || 'PRO';

        if (userId) {
          await StripeService.activateSubscription(userId, planCode);
          console.log(`[Stripe Webhook] Successfully activated subscription for user ${userId} to ${planCode}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data?.object;
        const userId = sub?.metadata?.userId;
        if (userId) {
          await StripeService.deactivateSubscription(userId);
          console.log(`[Stripe Webhook] Subscription canceled, downgraded user ${userId} to FREE`);
        }
        break;
      }

      default:
        // Other events ignored but acknowledged
        break;
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err: any) {
    console.error('[Stripe Webhook] Processing error:', err);
    return NextResponse.json({ error: err.message || 'Webhook processing error' }, { status: 500 });
  }
}
