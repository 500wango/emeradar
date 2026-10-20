-- 0046 — 需求补全（词量 / 意图 / 12 个月趋势）
--
-- 这三样都来自第三方估计，**只用于入口排序、展示与研报叙述，不进任何评分**：
-- D 轴若读供应商词量，会与 `external_demand_formed` 的事件判据自证（06 §7.1a）。
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS vendor_intent TEXT,
  ADD COLUMN IF NOT EXISTS demand_trend TEXT
    CHECK (demand_trend IN ('GROWING','FLAT','DECLINING')),
  ADD COLUMN IF NOT EXISTS demand_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entry_cpc NUMERIC(10,4);

CREATE INDEX IF NOT EXISTS idx_opportunities_demand_trend
  ON opportunities(demand_trend) WHERE demand_trend IS NOT NULL;

-- 逐月搜索量按次留档：趋势可以重算，原始序列要能回看。
CREATE TABLE IF NOT EXISTS opportunity_demand_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  monthly JSONB NOT NULL DEFAULT '[]'::jsonb,
  trend TEXT CHECK (trend IN ('GROWING','FLAT','DECLINING')),
  rule_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_demand_history_opp
  ON opportunity_demand_history(opportunity_id, fetched_at DESC);
