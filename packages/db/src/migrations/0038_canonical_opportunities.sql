-- 0038 — Phase 1：Canonical Opportunity（L1 词法指纹 + L2 SERP 交集）
--
-- 同一个需求会以多种写法进入候选池，例如：
--   template spreadsheet / template for spreadsheet
--   csv to excel conversion / convert a csv file to excel
-- 分开观测会把 14 天证据切成两半，两侧都过不了门槛，还会把 API 预算烧在同一个需求上。
--
-- 注意：Surface Query（真正发给 Google 的原词）**必须保留**，不能被归一键覆盖。

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS lexical_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS canonical_opportunity_id TEXT;

CREATE INDEX IF NOT EXISTS idx_opportunities_lexical
  ON opportunities(lexical_fingerprint);
CREATE INDEX IF NOT EXISTS idx_opportunities_canonical
  ON opportunities(canonical_opportunity_id);

-- 合并簇。`merge_rule_version` 决定“什么算同一个意图”，规则改版必须重新计算，
-- 不能拿 v1 的合并结果去解释 v2 的裁决。
CREATE TABLE IF NOT EXISTS opportunity_clusters (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  market_country TEXT NOT NULL,
  research_language TEXT NOT NULL,
  representative_opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  merge_rule_version TEXT NOT NULL,
  merge_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (canonical_key, market_country, research_language)
);

-- 成员表保留 **surface query**：发往 Google 的永远是原词，归一只用于合并观测。
CREATE TABLE IF NOT EXISTS opportunity_cluster_members (
  cluster_id TEXT NOT NULL REFERENCES opportunity_clusters(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  surface_query TEXT NOT NULL,
  lexical_fingerprint TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cluster_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_members_opp
  ON opportunity_cluster_members(opportunity_id);
