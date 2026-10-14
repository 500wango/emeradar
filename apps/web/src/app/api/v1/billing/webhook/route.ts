import { NextRequest, NextResponse } from 'next/server';
import { StripeService, StealthLockService, mapStripeSubscriptionStatus } from '@emeradar/services';

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
        /**
         * 买断必须**早于**订阅分支判掉（10 §4.5b）。
         *
         * 两个分支看的是同一个事件，而订阅那条会去 `validatePaidCheckout` 按
         * `stripe_checkout_intents` 断言行里的 planCode/billingCycle —— 买断压根不写
         * 那张表（它的 `plan_code` 是 `NOT NULL REFERENCES plans(code)`，而买断不是
         * 套餐，13 §3.1），校验必然抛错，落进下面的 catch 里 500 并释放幂等声明，
         * 于是 Stripe 按重试计划反复投递同一个必然失败的事件，而用户已经付过钱了。
         */
        if (object?.metadata?.purchaseKind === 'STEALTH_BUYOUT') {
          const outcome = await StealthLockService.confirmCheckout({
            paymentIntentId: typeof object?.payment_intent === 'string' ? object.payment_intent : null,
            metadata: (object?.metadata ?? {}) as Record<string, unknown>,
          });

          /**
           * `MISSING` **不许静默吞掉**：元数据里带着 `stealthLockId`，所以"钱到了但
           * 那把锁不在库里"是一件可以确切说出的事，不是只能推断的猜测。它是
           * "钱已收、交付物不在"的唯一剩余入口，必须有人看到——回 200 等于把它变成
           * 一条日志里的噪音。这里刻意**不**返回 5xx 去换重投：重投改变不了"锁不在"
           * 这个事实，只会让 Stripe 的投递队列里多一条永远失败的记录。
           *
           * 所以：记 P0、放行 200，由告警去叫人。同理 `UNATTRIBUTED`（元数据不全，
           * 说明这不是我们发出去的会话，或被改过）。
           */
          if (outcome.status === 'MISSING' || outcome.status === 'UNATTRIBUTED') {
            console.error(
              `[Stripe Webhook] P0 STEALTH LOCK UNRESOLVED (${outcome.status}): lock=${object?.metadata?.stealthLockId ?? '<none>'} ` +
                `pi=${object?.payment_intent ?? '<none>'} event=${eventId}. Payment received but no lock could be credited.`
            );
          } else if (outcome.status === 'VOIDED') {
            // 占位已作废（超过待付窗口）而钱到了。这个交错本来由"会话有效期短于
            // 宽限期"挡住，走到这里说明有更慢的一环。锁的价值已经不在，必须人工
            // 处置（退款或补发），所以同样按 P0 记录。
            console.error(
              `[Stripe Webhook] P0 STEALTH LOCK VOIDED BEFORE PAYMENT: lock=${outcome.lockId} pi=${object?.payment_intent} event=${eventId}.`
            );
          } else {
            console.log(
              `[Stripe Webhook] Stealth lock ${outcome.lockId} ${outcome.status.toLowerCase()} for opportunity ${outcome.opportunityId}.`
            );
          }
          break;
        }

        const userId = object?.metadata?.userId || object?.client_reference_id;
        const planCode = (object?.metadata?.planCode as 'PRO' | 'TEAM') || 'PRO';
        const billingCycle = object?.metadata?.billingCycle === 'lifetime'
          ? 'lifetime'
          : object?.metadata?.billingCycle === 'yearly'
          ? 'yearly'
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
          toIsoOrNull(object?.current_period_end),
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
          object?.subscription,
          'ACTIVE',
          toIsoOrNull(object?.lines?.data?.[0]?.period?.end)
        );
        break;
      }

      case 'invoice.payment_failed': {
        const userId = await StripeService.updateSubscriptionState(object?.subscription, 'PAST_DUE');
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
