-- 0009 — 质押窗口分档与"首次逾期退还 1 次配额"（PRD v2.2 Q5；31 T5.1）。
--
-- 纯新增，与 0001–0008 一样是前向迁移。
--
--   1. projects.go_quota_period_start：GO 扣额度时所在的计费周期。退额度必须退回
--      扣它的那个周期；跨周期逾期时按"当前周期"退会扣错账。存量行为 NULL，
--      退款条件 `period_start = NULL` 恒不成立，所以存量项目不会被误退。
--   2. stake_overdue_refunds：每位用户至多一行（user_id 主键）。"首次"由主键
--      冲突判定，而不是靠先查后写，所以并发的两次逾期释放不会退两次。

ALTER TABLE projects ADD COLUMN IF NOT EXISTS go_quota_period_start DATE;

CREATE TABLE IF NOT EXISTS stake_overdue_refunds (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  refunded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
