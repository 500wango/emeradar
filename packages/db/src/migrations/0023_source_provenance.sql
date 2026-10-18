-- 0023 — 采集溯源：SERP/Autocomplete 的供应商，以及 canonical source 注册
--
-- 0023 之前，`serp_snapshots` 只存结果、不存"谁给的"；Brave fallback 一旦触发，
-- W 轴会在不知情的情况下量另一个搜索引擎。Autocomplete 同样没有留下供应商。
ALTER TABLE serp_snapshots
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE serp_snapshots
  DROP CONSTRAINT IF EXISTS serp_snapshots_provider_check;
ALTER TABLE serp_snapshots
  ADD CONSTRAINT serp_snapshots_provider_check
  CHECK (provider IN ('SERPAPI','AISA_DATAFORSEO','UNKNOWN'));

ALTER TABLE autocomplete_observations
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE autocomplete_observations
  DROP CONSTRAINT IF EXISTS autocomplete_observations_provider_check;
ALTER TABLE autocomplete_observations
  ADD CONSTRAINT autocomplete_observations_provider_check
  CHECK (provider IN ('AISA_DATAFORSEO','UNKNOWN'));

-- 成本账本/证据里使用的是 collector 的 canonical id（src_ac / src_serp / src_crawl /
-- src_llm / src_checkout_referral），但 sources 表里是展示用的旧 id，二者 join 不上。
-- 这里补齐 canonical 行，并把旧展示行停用；历史 cost/evidence 行无需搬迁
-- （它们本来就用 canonical id）。
INSERT INTO sources (id, type, name, tos_risk_level, is_active)
VALUES
  ('src_ac', 'AUTOCOMPLETE', 'Google Autocomplete (AIsa DataForSEO)', 'MEDIUM', true),
  ('src_serp', 'SERP', 'Google SERP (SerpAPI / AIsa DataForSEO)', 'MEDIUM', true),
  ('src_crawl', 'COMMERCIAL', 'Commercial pricing crawler', 'MEDIUM', true),
  ('src_llm', 'OTHER', 'LLM narrative generation', 'LOW', true),
  ('src_checkout_referral', 'COMMERCIAL', 'Checkout referral radar', 'MEDIUM', true)
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type,
  name = EXCLUDED.name,
  tos_risk_level = EXCLUDED.tos_risk_level,
  is_active = EXCLUDED.is_active;

UPDATE sources
   SET is_active = false
 WHERE id IN ('src_google_autocomplete','src_serp_google','src_commercial_web');
