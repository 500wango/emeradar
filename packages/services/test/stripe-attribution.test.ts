import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { makeDisposableDb } from './helpers/disposable-db';

const webhookSecret = 'whsec_local_webhook_test';
let webhookSequence = 0;
async function sendWebhook(type: string, object: Record<string, unknown>) {
  const { POST } = await import('../../../apps/web/src/app/api/v1/billing/webhook/route');
  const body = JSON.stringify({ id: `evt_attrib_${++webhookSequence}`, type, data: { object } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', webhookSecret).update(`${timestamp}.${body}`).digest('hex');
  return POST(new Request('http://localhost/api/v1/billing/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
    body,
  }) as any);
}

/**
 * Stripe 事件的归因：从事件对象找回"这是谁的订阅"。
 *
 * 归因失败不是一条日志，是权益漏洞。争议、退款、扣款失败这些事件带的信息最少：
 * 一次性的终身版付款根本没有 Subscription 对象，`charge.dispute.created` 上的
 * `invoice` 也不展开，于是 `subscription` 字段是空的。查不到人，就等于"这笔钱出了
 * 问题，但那个账号的权益照旧" —— 争议期白送权益。
 *
 * 这里把链条的每一跳都造出来（含 mock 掉 Stripe 的单次 charge 查询），并钉住最后
 * 那一跳：全都查不到时必须返回 null 并留下一条 audit_log —— 而不是只往 stdout
 * 写一行警告然后让它轮转掉。
 */
const harness = makeDisposableDb('emeradar_stripe_attribution_test');

const SUB_USER = 'usr_attrib_sub';
const LIFETIME_USER = 'usr_attrib_lifetime';
const ORPHAN_USER = 'usr_attrib_orphan';
const SUB_STRIPE_ID = 'sub_attrib_123';
const LIFETIME_PI = 'pi_attrib_lifetime';

const originalFetch = globalThis.fetch;

describe('Stripe 事件的归因链', () => {
  before(async () => {
    await harness.setup(); if (harness.available) await harness.db.query(fs.readFileSync(path.resolve(__dirname,'../../db/src/payment-history.sql'),'utf8'));
    if (!harness.available) return;

    for (const [id, tier] of [
      [SUB_USER, 'PRO'],
      [LIFETIME_USER, 'PRO'],
      [ORPHAN_USER, 'PRO'],
    ] as const) {
      await harness.db.query(
        `INSERT INTO users (id, email, display_name, role, tier, status)
         VALUES ($1, $2, $1, 'USER', $3, 'ACTIVE')`,
        [id, `${id}@emeradar.test`, tier]
      );
    }

    await harness.db.query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start,
         current_period_end, entitlements_snapshot, stripe_subscription_id, stripe_customer_id)
       VALUES ('sub_row_attrib', $1, 'PRO', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days',
               '{}'::jsonb, $2, 'cus_attrib')`,
      [SUB_USER, SUB_STRIPE_ID]
    );
    // 终身版：没有 stripe_subscription_id，只有支付意图。
    await harness.db.query(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start,
         current_period_end, entitlements_snapshot, stripe_payment_intent_id, stripe_customer_id)
       VALUES ('sub_row_lifetime', $1, 'PRO', 'ACTIVE', NOW(), TIMESTAMPTZ '9999-12-31 23:59:59+00',
               '{}'::jsonb, $2, 'cus_lifetime')`,
      [LIFETIME_USER, LIFETIME_PI]
    );
  });

  after(async () => {
    await harness.teardown();
  });

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_attribution';
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('metadata 里的 userId 优先，不产生任何网络调用', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;

    let called = 0;
    globalThis.fetch = (async () => {
      called++;
      throw new Error('不该联网');
    }) as any;

    const userId = await StripeService.resolveUserIdFromStripeObject({
      metadata: { userId: SUB_USER },
      charge: 'ch_never_looked_up',
    });
    assert.strictEqual(userId, SUB_USER);
    assert.strictEqual(called, 0);
  });

  it('does not grant paid access when checkout payment_status is missing', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    await harness.db.query(`UPDATE users SET tier = 'FREE' WHERE id = $1`, [ORPHAN_USER]);
    const response = await sendWebhook('checkout.session.completed', {
      id: 'cs_missing_payment_status', status: 'complete', mode: 'payment',
      client_reference_id: ORPHAN_USER,
      metadata: { userId: ORPHAN_USER, planCode: 'PRO', billingCycle: 'lifetime' },
      amount_total: 129900, currency: 'usd', payment_intent: 'pi_missing_status',
    });
    assert.strictEqual(response.status, 200);
    const user = await harness.db.query<{ tier: string }>('SELECT tier FROM users WHERE id = $1', [ORPHAN_USER]);
    assert.strictEqual(user.rows[0].tier, 'FREE');
  });

  it('persists the server-side price and mode when creating a Stripe checkout', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    let submitted: URLSearchParams | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      submitted = new URLSearchParams(String(init.body));
      return { ok: true, json: async () => ({ id: 'cs_persisted_intent', url: 'https://checkout.stripe.com/test' }) };
    }) as any;
    const created = await harness.services.StripeService.createCheckoutSession({
      userId: ORPHAN_USER, planCode: 'PRO', billingCycle: 'lifetime',
    });
    assert.strictEqual(created.sessionId, 'cs_persisted_intent');
    assert.strictEqual(submitted?.get('line_items[0][price_data][unit_amount]'), '129900');
    const intent = await harness.db.query<{
      user_id: string; plan_code: string; billing_cycle: string; amount_cents: number; currency: string; mode: string;
    }>(`SELECT user_id, plan_code, billing_cycle, amount_cents, currency, mode
          FROM stripe_checkout_intents WHERE id = $1`, [created.sessionId]);
    assert.deepStrictEqual(intent.rows[0], {
      user_id: ORPHAN_USER, plan_code: 'PRO', billing_cycle: 'lifetime',
      amount_cents: 129900, currency: 'usd', mode: 'payment',
    });
  });

  it('终身版退款：靠 payment_intent 归因（没有 Subscription 对象可查）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;
    globalThis.fetch = (async () => {
      throw new Error('不该联网：本地列就能答出这一跳');
    }) as any;

    const userId = await StripeService.resolveUserIdFromStripeObject({
      id: 'ch_lifetime',
      payment_intent: LIFETIME_PI,
    });
    assert.strictEqual(userId, LIFETIME_USER, '终身版退款事件找不到人');
  });

  it('只带 charge 的争议：展开 invoice 走到 subscription 再回到用户', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;

    let requested = '';
    globalThis.fetch = (async (url: string) => {
      requested = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'ch_disputed',
          payment_intent: 'pi_unrelated',
          invoice: { subscription: SUB_STRIPE_ID },
        }),
      };
    }) as any;

    const userId = await StripeService.resolveUserIdFromStripeObject({ id: 'dp_1', charge: 'ch_disputed' });
    assert.strictEqual(userId, SUB_USER, 'charge → invoice → subscription 这一跳断了');

    // Stripe 文档本身写的就是未编码的 `expand[]=invoice`，Node 的 fetch 也接受，
    // 所以这里只断言语义而不是编码形式。
    assert.ok(
      requested.includes('/v1/charges/ch_disputed') && /expand(\[\]|%5B%5D)=invoice/.test(requested),
      `没有展开 invoice，拿不到 subscription：${requested}`
    );
  });

  it('charges 接口报错时不猜，返回 null', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;

    globalThis.fetch = (async () => ({ ok: false, status: 404, json: async () => ({}) })) as any;
    const userId = await StripeService.resolveUserIdFromStripeObject({ charge: 'ch_missing' });
    assert.strictEqual(userId, null);
  });

  it('归因失败留下可查询的记录，而不是一行会轮转掉的警告', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { StripeService } = harness.services;

    globalThis.fetch = (async () => ({ ok: false, status: 404, json: async () => ({}) })) as any;

    const orphan = { id: 'ch_orphan', customer: 'cus_unknown', charge: 'ch_orphan' };
    assert.strictEqual(await StripeService.resolveUserIdFromStripeObject(orphan), null);
    await assert.rejects(
      () => StripeService.recordAttributionFailure('charge.refunded', 'evt_orphan_1', orphan),
      /retry required/
    );

    const logged = await harness.db.query<{ payload: any }>(
      `SELECT payload FROM audit_log
        WHERE action = 'stripe.attribution_failed' AND target_id = $1`,
      ['evt_orphan_1']
    );
    assert.strictEqual(logged.rows.length, 1, '归因失败没有留下审计记录 —— 权益会一直留着且无人知道');
    assert.strictEqual(logged.rows[0].payload.eventType, 'charge.refunded');
    assert.strictEqual(logged.rows[0].payload.charge, 'ch_orphan');
  });

  it('returns 500 and releases the claim when Stripe lookup is temporarily unavailable', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    globalThis.fetch = (async () => ({ ok: false, status: 503 })) as any;
    const response = await sendWebhook('charge.dispute.created', { id: 'dp_retry', charge: 'ch_retry' });
    assert.strictEqual(response.status, 500);
    const claim = await harness.db.query(`SELECT id FROM webhook_events WHERE id = $1`, [`evt_attrib_${webhookSequence}`]);
    assert.strictEqual(claim.rows.length, 0);
  });

  it('validates recorded checkout amount, mode, user and paid state', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const session = {
      id: 'cs_persisted_intent', payment_status: 'paid', mode: 'payment',
      amount_total: 129900, currency: 'usd', payment_intent: 'pi_validated',
      metadata: { userId: ORPHAN_USER, planCode: 'PRO', billingCycle: 'lifetime' },
    };
    assert.strictEqual(await harness.services.StripeService.validatePaidCheckout(session), true);
    for (const changes of [{ payment_status: 'unpaid' }, { amount_total: 1 }, { mode: 'subscription' }, { currency: 'eur' }]) {
      assert.strictEqual(await harness.services.StripeService.validatePaidCheckout({ ...session, ...changes }), false);
    }
  });

  it('recovers a legacy paid checkout only after a matching authoritative Stripe read', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const session = {
      id: 'cs_legacy_verified', status: 'complete', payment_status: 'paid', mode: 'payment',
      amount_total: 129900, currency: 'usd', payment_intent: 'pi_legacy_verified',
      client_reference_id: ORPHAN_USER,
      metadata: { userId: ORPHAN_USER, planCode: 'PRO', billingCycle: 'lifetime' },
    };
    let reads = 0;
    globalThis.fetch = (async () => {
      reads++;
      return { ok: true, json: async () => session };
    }) as any;
    assert.strictEqual(await harness.services.StripeService.validatePaidCheckout(session), true);
    assert.strictEqual(reads, 1);
    const intent = await harness.db.query(`SELECT id FROM stripe_checkout_intents WHERE id = $1`, [session.id]);
    assert.strictEqual(intent.rows.length, 1);
    assert.strictEqual(await harness.services.StripeService.validatePaidCheckout(session), true);
    assert.strictEqual(reads, 1, 'recovered intent should not require another network read');
  });

  it('does not recover a legacy checkout when Stripe disagrees with the submitted amount', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const session = {
      id: 'cs_legacy_mismatch', status: 'complete', payment_status: 'paid', mode: 'payment',
      amount_total: 129900, currency: 'usd', payment_intent: 'pi_legacy_mismatch',
      client_reference_id: ORPHAN_USER,
      metadata: { userId: ORPHAN_USER, planCode: 'PRO', billingCycle: 'lifetime' },
    };
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ ...session, amount_total: 1 }) })) as any;
    await assert.rejects(() => harness.services.StripeService.validatePaidCheckout(session), /reconciliation/);
    const intent = await harness.db.query(`SELECT id FROM stripe_checkout_intents WHERE id = $1`, [session.id]);
    assert.strictEqual(intent.rows.length, 0);
  });

  it('Stripe 的状态映射：未知状态落在宽限而不是断供', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { mapStripeSubscriptionStatus } = harness.services;

    assert.strictEqual(mapStripeSubscriptionStatus('active'), 'ACTIVE');
    assert.strictEqual(mapStripeSubscriptionStatus('trialing'), 'ACTIVE');
    assert.strictEqual(mapStripeSubscriptionStatus('canceled'), 'CANCELED');
    assert.strictEqual(mapStripeSubscriptionStatus('unpaid'), 'CANCELED');
    assert.strictEqual(mapStripeSubscriptionStatus('incomplete_expired'), 'CANCELED');
    assert.strictEqual(mapStripeSubscriptionStatus('past_due'), 'PAST_DUE');
    // 我们不认识的取值必须落进宽限期（fail-soft），而且这个选择要被钉住：
    // 改动它等于改变"Stripe 新增一个状态时用户会不会立刻被断供"。
    assert.strictEqual(mapStripeSubscriptionStatus('paused'), 'PAST_DUE');
    assert.strictEqual(mapStripeSubscriptionStatus(undefined), 'PAST_DUE');
  });
});
