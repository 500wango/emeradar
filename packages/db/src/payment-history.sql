-- Additive payment attribution; apply after schema.sql (safe to re-run).
CREATE TABLE IF NOT EXISTS stripe_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  stripe_subscription_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  refunded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (stripe_subscription_id IS NOT NULL OR stripe_payment_intent_id IS NOT NULL)
);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_purchase_id TEXT REFERENCES stripe_purchases(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_hold_purchase_id TEXT REFERENCES stripe_purchases(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_hold_prior_status TEXT;
CREATE TABLE IF NOT EXISTS stripe_payment_disputes (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES stripe_purchases(id),
  status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
-- Existing identifiers are trustworthy only for the currently linked purchase.
INSERT INTO stripe_purchases(id,user_id,stripe_subscription_id,stripe_payment_intent_id)
SELECT 'legacy:' || id,user_id,stripe_subscription_id,stripe_payment_intent_id
FROM subscriptions WHERE stripe_subscription_id IS NOT NULL OR stripe_payment_intent_id IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE subscriptions s SET stripe_purchase_id=p.id FROM stripe_purchases p
WHERE s.stripe_purchase_id IS NULL AND p.user_id=s.user_id
AND (p.stripe_subscription_id=s.stripe_subscription_id OR p.stripe_payment_intent_id=s.stripe_payment_intent_id);
