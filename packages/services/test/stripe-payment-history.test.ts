import { before, after, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeDisposableDb } from './helpers/disposable-db';
const h = makeDisposableDb('emeradar_payment_history');
before(async () => { await h.setup(); if (h.available) await h.db.query(fs.readFileSync(path.resolve(__dirname,'../../db/src/payment-history.sql'),'utf8')); });
after(async () => { await h.teardown(); });

test('a delayed partial refund preserves access and completes atomically', async t => {
  if (!h.available) return t.skip(h.skipReason);
  await h.db.query(`INSERT INTO users (id,email,tier) VALUES ('pay_user','pay@test.invalid','PRO')`);
  await h.services.StripeService.activateSubscription('pay_user','PRO','lifetime',{stripePaymentIntentId:'pi_history'});
  await h.db.query(`INSERT INTO stripe_event_retries(event_id,event_type,object_id) VALUES ('evt_partial','charge.refunded','ch_history')`);
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'test-placeholder';
  globalThis.fetch = (async (url: string) => ({ok:true,json:async()=> String(url).includes('/events/')
    ? {id:'evt_partial',type:'charge.refunded',data:{object:{id:'ch_history'}}}
    : {id:'ch_history',payment_intent:'pi_history',amount:39900,amount_refunded:100,currency:'usd'}})) as any;
  try {
    assert.equal((await h.services.retryStripeAttributions()).completed,1);
    assert.equal((await h.db.query(`SELECT status FROM subscriptions WHERE user_id='pay_user'`)).rows[0].status,'ACTIVE');
  } finally { globalThis.fetch=oldFetch; if(oldKey===undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY=oldKey; }
});

test('old full refunds preserve replacement purchases and replay cannot revive old purchase', async t => {
  if (!h.available) return t.skip(h.skipReason);
  await h.services.StripeService.activateSubscription('pay_user','PRO','lifetime',{stripePaymentIntentId:'pi_replacement'});
  await h.db.query(`INSERT INTO stripe_event_retries(event_id,event_type,object_id) VALUES ('evt_old_full','charge.refunded','ch_history')`);
  const original = globalThis.fetch;
  const key = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY='test-placeholder';
  globalThis.fetch = (async (url: string) => ({ok:true,json:async()=> String(url).includes('/events/')
    ? {id:'evt_old_full',type:'charge.refunded',data:{object:{id:'ch_history'}}}
    : {id:'ch_history',payment_intent:'pi_history',amount:39900,amount_refunded:39900,currency:'usd'}})) as any;
  try {
    assert.equal((await h.services.retryStripeAttributions()).completed,1);
    await h.services.StripeService.activateSubscription('pay_user','PRO','lifetime',{stripePaymentIntentId:'pi_history'});
    const sub=(await h.db.query(`SELECT status,stripe_purchase_id FROM subscriptions WHERE user_id='pay_user'`)).rows[0];
    assert.equal(sub.status,'ACTIVE');
    assert.equal(sub.stripe_purchase_id,'payment:pi_replacement');
  } finally {globalThis.fetch=original; if(key===undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY=key;}
});

test('won dispute restores its purchase hold but never lifts admin suspension', async t => {
  if (!h.available) return t.skip(h.skipReason);
  const original=globalThis.fetch;
  const key=process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY='test-placeholder';
  let status='needs_response';
  let event='evt_dispute_open';
  globalThis.fetch=(async (url:string)=>({ok:true,json:async()=>String(url).includes('/events/')
    ? {id:event,type:'charge.dispute.created',data:{object:{id:'dp_current'}}}
    : String(url).includes('/disputes/') ? {id:'dp_current',charge:'ch_current',status}
    : {id:'ch_current',payment_intent:'pi_replacement',amount:39900,amount_refunded:0}})) as any;
  try {
    await h.db.query(`INSERT INTO stripe_event_retries(event_id,event_type,object_id) VALUES ($1,'charge.dispute.created','dp_current')`,[event]);
    assert.equal((await h.services.retryStripeAttributions()).completed,1);
    assert.equal((await h.db.query(`SELECT status FROM subscriptions WHERE user_id='pay_user'`)).rows[0].status,'CANCELED');
    await h.db.query(`UPDATE users SET status='SUSPENDED' WHERE id='pay_user'`);
    event='evt_dispute_won'; status='won';
    await h.db.query(`INSERT INTO stripe_event_retries(event_id,event_type,object_id) VALUES ($1,'charge.dispute.created','dp_current')`,[event]);
    assert.equal((await h.services.retryStripeAttributions()).completed,1);
    assert.equal((await h.db.query(`SELECT status FROM subscriptions WHERE user_id='pay_user'`)).rows[0].status,'ACTIVE');
    assert.equal((await h.db.query(`SELECT status FROM users WHERE id='pay_user'`)).rows[0].status,'SUSPENDED');
  } finally {globalThis.fetch=original;if(key===undefined) delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=key;}
});
