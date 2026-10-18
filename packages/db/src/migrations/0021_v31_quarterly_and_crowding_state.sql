-- 0021 — 季度 Builder Pass 的结账周期，以及 CROWDING_SIGNAL 的推送游标
--
-- 0020 已经给 `subscriptions` 加了 `billing_interval`（CHECK 允许 QUARTER），但
-- `stripe_checkout_intents.billing_cycle` 仍只允许 monthly / yearly / lifetime。
-- 季度结账在创建 intent 时会被这条 CHECK 拒绝，所以先放宽它。
ALTER TABLE stripe_checkout_intents
  DROP CONSTRAINT IF EXISTS stripe_checkout_intents_billing_cycle_check;

ALTER TABLE stripe_checkout_intents
  ADD CONSTRAINT stripe_checkout_intents_billing_cycle_check
  CHECK (billing_cycle IN ('monthly','quarterly','yearly','lifetime'));

-- CROWDING_SIGNAL 的"较上一次推送增加"需要一个按规则保存的游标。`crowding_daily`
-- 只有当日观测，没有"上次推送"的记忆；用规则 id 做主键，随规则删除级联清理。
CREATE TABLE IF NOT EXISTS crowding_alert_state (
  rule_id TEXT PRIMARY KEY REFERENCES alert_rules(id) ON DELETE CASCADE,
  last_verified_product_count INTEGER,
  last_new_top10_entrants_30d INTEGER,
  last_fired_on DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
