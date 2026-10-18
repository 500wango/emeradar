-- 0028 — 机会发现反馈闭环
--
-- 用户比模型更早知道"这个我做不了 / 这个已经有人做了 / 这个不是机会"。
-- 记录在机会维度上，供 Inbox 排序与后续校准使用；不改变已封存的 verdict。
CREATE TABLE IF NOT EXISTS opportunity_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('INTERESTED','SAVED','NOT_OPPORTUNITY','ALREADY_BUILT','CANNOT_BUILD')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, opportunity_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_feedback_user
  ON opportunity_feedback(user_id, created_at DESC);
