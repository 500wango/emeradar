-- 0040 — Phase 2：Shadow Pool（反事实暗池）
--
-- 单主源 + 严格 Gate 必然高精确、低召回。最大的风险不是判错，而是**静默漏判**：
-- 被 Day 3 毙掉的词后来成了机会，而我们永远不知道，因为抓取已经停了。
--
-- 暗池在任何成本放大之前先解决“测得到”：
--   - 按拒绝原因**分层**抽样（不同原因的漏判机制不同，随机 5% 会全落在某一层）；
--   - 暗池不进入每日全量，只在 T+30/60/90 三次低成本回访；
--   - 结果写回 outcome，用于估计加权 False Negative Rate。
CREATE TABLE IF NOT EXISTS shadow_pool_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  rejection_id UUID REFERENCES opportunity_rejections(id) ON DELETE SET NULL,
  stratum TEXT NOT NULL,
  axis TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  sampled_on DATE NOT NULL,
  -- 抽样权重：1/抽样概率。加权后才能从分层样本还原总体漏判率。
  sampling_weight NUMERIC(10,4) NOT NULL DEFAULT 1,
  sampling_rule_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','DROPPED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, sampled_on)
);

CREATE INDEX IF NOT EXISTS idx_shadow_samples_stratum
  ON shadow_pool_samples(stratum, sampled_on DESC);

CREATE TABLE IF NOT EXISTS shadow_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id UUID NOT NULL REFERENCES shadow_pool_samples(id) ON DELETE CASCADE,
  horizon_days INTEGER NOT NULL CHECK (horizon_days IN (30,60,90)),
  due_date DATE NOT NULL,
  captured_at TIMESTAMPTZ,
  -- CANDIDATE_BECAME_OPPORTUNITY 表示“当初被拒、现在市场形成”——即一次漏判。
  outcome TEXT CHECK (outcome IN ('CANDIDATE_BECAME_OPPORTUNITY','STILL_REJECTED','INSUFFICIENT_DATA')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sample_id, horizon_days)
);

CREATE INDEX IF NOT EXISTS idx_shadow_checkpoints_due
  ON shadow_checkpoints(due_date) WHERE captured_at IS NULL;
