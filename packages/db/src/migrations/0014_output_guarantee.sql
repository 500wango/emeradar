-- 0014 — 兜底承诺记账（31 T5.10；PRD v2.2 Q7，13 §8）。
--
-- 连续 2 周全平台合格 BUILD_NOW + EARLY_BET 为 0 时，所有活跃 Pro 订阅自动延长 7 天。
-- 每次触发一行；window_end 唯一，保证同一个「零产出窗口」只补偿一次（任务重跑安全）。
-- 补偿只给时长，不退现金；触发判定读账本 verdicts，不读任何可调阈值。

CREATE TABLE IF NOT EXISTS output_guarantee_grants (
  id TEXT PRIMARY KEY,
  window_end DATE NOT NULL UNIQUE,
  window_days SMALLINT NOT NULL,
  subscriptions_extended INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
