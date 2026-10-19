-- 0037 — Phase 0：原始账本补全 + 版本标记 + 拒绝分类
--
-- 目标：任一历史裁决都能用 (raw_payload + rule_version) 重算。
-- 本迁移只加列/表，不改任何 Gate 行为。

-- 1. raw_payloads：补齐回溯所需的事实（谁、在哪、什么时候、HTTP 什么状态）
ALTER TABLE raw_payloads
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS request_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS http_status INTEGER,
  ADD COLUMN IF NOT EXISTS locale TEXT,
  ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'application/json',
  ADD COLUMN IF NOT EXISTS byte_size INTEGER;

COMMENT ON COLUMN raw_payloads.request_params IS
  '发起这次请求的参数（query/location_code/language_code/depth 等），重放时必须一致';

CREATE INDEX IF NOT EXISTS idx_raw_payloads_hash ON raw_payloads(content_hash);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_source_time ON raw_payloads(source_id, fetched_at DESC);

-- 2. evidence：解析结果必须带提取器版本；原始事实用 raw_payload_id 指回去
ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS raw_payload_id UUID REFERENCES raw_payloads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extractor_version TEXT;

COMMENT ON COLUMN evidence.extractor_version IS
  '解析规则版本。同一份 raw 在不同版本下可能得到不同证据，所以必须记下来';

-- 3. verdicts：除 scoring_config_version 之外，再记特征与规则引擎版本
ALTER TABLE verdicts
  ADD COLUMN IF NOT EXISTS feature_version TEXT,
  ADD COLUMN IF NOT EXISTS rule_engine_version TEXT;

-- 4. 拒绝分类：每个被拒的机会都要能回答“死在哪一轴、哪条规则、哪份证据”
CREATE TABLE IF NOT EXISTS opportunity_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  obs_date DATE NOT NULL,
  axis TEXT NOT NULL CHECK (axis IN ('D','M','W','DATA','PUBLICATION')),
  reason_code TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  rule_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, obs_date, axis, reason_code)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_rejections_reason
  ON opportunity_rejections(reason_code, obs_date DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_rejections_opp
  ON opportunity_rejections(opportunity_id, obs_date DESC);
