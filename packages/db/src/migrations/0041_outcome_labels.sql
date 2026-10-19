-- 0041 — Phase 3：分层标签（不是 ground truth）
--
-- 无法用“自己做产品的收入”当标签，只能找**市场演进结果**做因变量。但这类结果
-- 只是代理，必须分层存储，否则会把趋势、自身影响力与存活偏差一起算成“模型命中”：
--
--   MARKET_FORMED_PROXY  自动观测（新独立站 + PRICED + 维持排名），置信度中
--   MANUAL_AUDIT         人工抽查确认，置信度高，回测的金标准
--   NO_LABEL             数据不足/被拦截，明确区别于“负样本”
CREATE TABLE IF NOT EXISTS outcome_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  horizon_days INTEGER NOT NULL CHECK (horizon_days IN (30,60,90)),
  label_type TEXT NOT NULL CHECK (label_type IN ('MARKET_FORMED_PROXY','MANUAL_AUDIT','NO_LABEL')),
  label TEXT NOT NULL CHECK (label IN ('POSITIVE','NEGATIVE','UNKNOWN')),
  confidence TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  label_rule_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, horizon_days, label_type)
);

CREATE INDEX IF NOT EXISTS idx_outcome_labels_horizon
  ON outcome_labels(horizon_days, label_type, label);
