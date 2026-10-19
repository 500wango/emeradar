-- 0043 — Phase 3：阈值变更提案（DRAFT → SHADOW → ACTIVE）
--
-- 回测只能**产出提案**，不能改线上。这张表把“谁在什么数据上、按什么规则提出把阈值
-- 从 X 改成 Y、预期收益多少”留下来，即使提案最后被否，也能回答“当时为什么这么想”。
--
-- 线上配置仍然是代码里的版本化常量（`SCORING_CONFIG_VERSION`）；提案被批准后
-- 由人改代码、发版，再进入 SHADOW 观察。没有任何自动应用路径。
CREATE TABLE IF NOT EXISTS scoring_config_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SHADOW','APPROVED','REJECTED','ACTIVE')),
  parameter TEXT NOT NULL,
  current_value TEXT,
  proposed_value TEXT NOT NULL,
  horizon_days INTEGER,
  sample_size INTEGER NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  backtest_rule_version TEXT NOT NULL,
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_scoring_proposals_status
  ON scoring_config_proposals(status, created_at DESC);
