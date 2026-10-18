-- 0022 — 自定义词 7 天脉冲雷达（PRD F3 第 2 阶段、12 §2）
--
-- 即时初筛把自定义词变成 CANDIDATE 机会；Pro 用户可把它加入雷达。S7 每轮检查
-- ACTIVE 且未过期的雷达，机会晋升 BUILD_NOW 时推一条站内通知并落 CONFIRMED。
-- 入雷达不另扣额度：初筛那一步已经扣过 `live_scan_*`；权益门槛是 `pulse_radar`。
CREATE TABLE IF NOT EXISTS custom_query_radars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CONFIRMED','EXPIRED')),
  confirmed_at TIMESTAMPTZ,
  UNIQUE (user_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_query_radars_due
  ON custom_query_radars(status, expires_at);
