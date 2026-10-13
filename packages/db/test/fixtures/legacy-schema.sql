-- ============================================================================
-- Emeradar PostgreSQL 15+ Complete Schema Definition
-- Based on 03-DATA-MODEL.md and related specifications
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);

-- 1. 用户与认证 (NextAuth / Auth.js v5)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                         -- usr_01J...
  email CITEXT NOT NULL UNIQUE,
  email_verified_at TIMESTAMPTZ,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','ANALYST','ADMIN','SUPPORT')),
  tier TEXT NOT NULL DEFAULT 'FREE' CHECK (tier IN ('FREE','PRO','TEAM')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL
);

-- Session and verification tokens are bearer credentials, so the application
-- stores only their SHA-256 digest. Sessions written before that change would
-- hold the token in the clear and can never match a hashed lookup; drop them
-- rather than leaving live credentials in the table. Idempotent: the DELETE
-- matches nothing once every row is a digest.
DELETE FROM sessions WHERE session_token !~ '^[0-9a-f]{64}$';

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ui_locale TEXT NOT NULL DEFAULT 'zh-CN' CHECK (ui_locale IN ('zh-CN','en-US')),
  preferred_build_types TEXT[] NOT NULL DEFAULT '{}',
  preferred_markets TEXT[] NOT NULL DEFAULT '{"US"}',
  preferred_time_budget TEXT CHECK (preferred_time_budget IN ('WEEKEND','TWO_WEEKS','ONE_MONTH')),
  topics TEXT[] NOT NULL DEFAULT '{}',
  notification_channels JSONB NOT NULL DEFAULT '{}',
  onboarding_completed BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash CHAR(64) NOT NULL UNIQUE,
  label TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{"opportunities:read"}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- 2. 数据采集源与原始载荷
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,                         -- src_
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  tos_risk_level TEXT NOT NULL DEFAULT 'LOW' CHECK (tos_risk_level IN ('LOW','MEDIUM','HIGH')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collector_runs (
  id TEXT PRIMARY KEY,                         -- run_
  source_id TEXT NOT NULL REFERENCES sources(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCESS','PARTIAL','FAILED')),
  items_collected INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS raw_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_run_id TEXT NOT NULL REFERENCES collector_runs(id),
  storage_url TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 实体、查询与机会核心
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,                         -- ent_
  canonical_name TEXT NOT NULL,
  category TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY,                         -- qry_
  query_text TEXT NOT NULL,
  market_country TEXT NOT NULL DEFAULT 'US',
  research_language TEXT NOT NULL DEFAULT 'en-US',
  first_seen_date DATE NOT NULL DEFAULT CURRENT_DATE,
  tier TEXT NOT NULL DEFAULT 'C' CHECK (tier IN ('A','B','C')),
  entity_id TEXT REFERENCES entities(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (query_text, market_country, research_language)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,                         -- opp_
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'TRACKED' CHECK (status IN ('CANDIDATE','TRACKED','ARCHIVED')),
  market_country TEXT NOT NULL DEFAULT 'US',
  research_language TEXT NOT NULL DEFAULT 'en-US',
  first_observed_date DATE NOT NULL DEFAULT CURRENT_DATE,
  recommended_archetype TEXT NOT NULL DEFAULT 'LIGHTWEIGHT_TOOL',
  execution_class TEXT NOT NULL DEFAULT 'S' CHECK (execution_class IN ('S','M','L')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS discovery_source TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS candidate_reason TEXT;

CREATE TABLE IF NOT EXISTS opportunity_queries (
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('PRIMARY','SECONDARY','CLUSTER')),
  PRIMARY KEY (opportunity_id, query_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_opp_query_one_primary ON opportunity_queries (opportunity_id) WHERE role = 'PRIMARY';

-- 4. 每日快照与物化卡片
CREATE TABLE IF NOT EXISTS opportunity_snapshots (
  id TEXT PRIMARY KEY,                         -- snp_
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  obs_date DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  sealed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, obs_date)
);

CREATE TABLE IF NOT EXISTS opportunity_cards (
  opportunity_id TEXT PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  primary_query TEXT NOT NULL,
  verdict TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  d_basis_points INTEGER NOT NULL,
  m_basis_points INTEGER NOT NULL,
  w_basis_points INTEGER NOT NULL,
  d_band TEXT NOT NULL,
  m_band TEXT NOT NULL,
  w_band TEXT NOT NULL,
  confidence TEXT NOT NULL,
  recommended_archetype TEXT NOT NULL,
  execution_class TEXT NOT NULL,
  why_now_summary TEXT NOT NULL,
  top_idea TEXT NOT NULL,
  first_observed_at TIMESTAMPTZ NOT NULL,
  query_velocity NUMERIC(8,2) NOT NULL DEFAULT 1.0,
  featured_evidence_id TEXT,
  featured_evidence_snippet TEXT,
  stale BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE opportunity_cards ADD COLUMN IF NOT EXISTS search_intent TEXT;
ALTER TABLE opportunity_cards ADD COLUMN IF NOT EXISTS recommended_product_shape TEXT;
ALTER TABLE opportunity_cards ADD COLUMN IF NOT EXISTS site_strategy TEXT;
ALTER TABLE opportunity_cards ADD COLUMN IF NOT EXISTS intent_evidence JSONB NOT NULL DEFAULT '{}';

-- 5. 采集观察：Autocomplete 与 SERP
CREATE TABLE IF NOT EXISTS autocomplete_observations (
  query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  observed_date DATE NOT NULL,
  suggestions TEXT[] NOT NULL DEFAULT '{}',
  depth INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (query_id, observed_date)
);

CREATE TABLE IF NOT EXISTS serp_snapshots (
  id TEXT PRIMARY KEY,                         -- srp_
  query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  obs_date DATE NOT NULL,
  raw_payload_id UUID,
  weak_result_ratio NUMERIC(5,4) NOT NULL DEFAULT 0.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (query_id, obs_date)
);

CREATE TABLE IF NOT EXISTS serp_results (
  serp_snapshot_id TEXT NOT NULL REFERENCES serp_snapshots(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 20),
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT,
  result_type TEXT NOT NULL DEFAULT 'ORGANIC',
  domain_authority_class TEXT NOT NULL DEFAULT 'SPECIALIST',
  is_weak BOOLEAN NOT NULL DEFAULT false,
  weakness_type TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (serp_snapshot_id, rank)
);

-- 6. 商业信号与定价
CREATE TABLE IF NOT EXISTS commercial_targets (
  id TEXT PRIMARY KEY,                         -- cmt_
  domain TEXT UNIQUE NOT NULL,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED_DMCA','INACTIVE')),
  last_crawled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commercial_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_target_id TEXT NOT NULL REFERENCES commercial_targets(id),
  obs_date DATE NOT NULL,
  pricing_plans JSONB NOT NULL DEFAULT '[]',
  payment_gateways TEXT[] NOT NULL DEFAULT '{}',
  commercial_stage TEXT NOT NULL DEFAULT 'NONE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One snapshot per (target, date). De-duplicate pre-existing rows (keep newest)
-- before enforcing the constraint so re-running the migration is safe.
DELETE FROM commercial_snapshots a
 WHERE EXISTS (
   SELECT 1 FROM commercial_snapshots b
   WHERE b.commercial_target_id = a.commercial_target_id
     AND b.obs_date = a.obs_date
     AND (b.created_at > a.created_at
          OR (b.created_at = a.created_at AND b.id > a.id))
 );
ALTER TABLE commercial_snapshots DROP CONSTRAINT IF EXISTS uq_commercial_snapshot_target_date;
ALTER TABLE commercial_snapshots
  ADD CONSTRAINT uq_commercial_snapshot_target_date UNIQUE (commercial_target_id, obs_date);

ALTER TABLE commercial_snapshots ADD COLUMN IF NOT EXISTS fetch_tier TEXT NOT NULL DEFAULT 'STATIC';
ALTER TABLE commercial_snapshots ADD COLUMN IF NOT EXISTS fetch_status TEXT NOT NULL DEFAULT 'OK'
  CHECK (fetch_status IN ('OK','FAILED','ROBOTS_DISALLOWED','BUDGET_SKIPPED','BLOCKED_404'));
ALTER TABLE commercial_snapshots ADD COLUMN IF NOT EXISTS dynamic_shell BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_commercial_snapshot_target_date
  ON commercial_snapshots (commercial_target_id, obs_date DESC);

-- A target domain can serve several opportunities; sampling coverage (07 §5,§6.1)
-- and persistence (07 §7) are only computable per opportunity.
CREATE TABLE IF NOT EXISTS commercial_target_opportunities (
  commercial_target_id TEXT NOT NULL REFERENCES commercial_targets(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  validation_level TEXT NOT NULL DEFAULT 'DIRECT'
    CHECK (validation_level IN ('DIRECT','CATEGORY','ANALOG')),
  first_linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (commercial_target_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS idx_cto_opportunity ON commercial_target_opportunities(opportunity_id);

-- 07 §8 owner grouping: seeded with the registrable domain; owner-signal
-- union-find is not implemented yet, so independence stays conservative.
ALTER TABLE commercial_targets ADD COLUMN IF NOT EXISTS owner_group TEXT;

-- 7. 证据链条 (Evidence)
CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- evd_
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  evidence_class TEXT NOT NULL CHECK (evidence_class IN ('OBSERVED','SELF_REPORTED','THIRD_PARTY_ESTIMATE','INFERRED')),
  source_type TEXT NOT NULL,
  source_id TEXT,
  domain TEXT,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS source_item_id TEXT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS source_published_at TIMESTAMPTZ;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS request_hash CHAR(64);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS content_hash CHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_discovery_item
  ON evidence (source_id, source_item_id) WHERE source_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evidence_opp ON evidence(opportunity_id);

-- Public discovery facts are intentionally independent from opportunity scoring.
CREATE TABLE IF NOT EXISTS discovery_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_item_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  source_published_at TIMESTAMPTZ,
  first_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash CHAR(64) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE (source_id, source_item_id)
);
CREATE INDEX IF NOT EXISTS idx_discovery_items_published ON discovery_items(source_published_at DESC);

CREATE TABLE IF NOT EXISTS discovery_intents (
  id TEXT PRIMARY KEY,
  discovery_item_id TEXT NOT NULL REFERENCES discovery_items(id) ON DELETE CASCADE,
  intent_kind TEXT NOT NULL CHECK (intent_kind IN ('USE','DOWNLOAD','ALTERNATIVE','API','COMPARE','TUTORIAL')),
  query_hypothesis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'HYPOTHESIS' CHECK (status IN ('HYPOTHESIS','OBSERVED','REJECTED')),
  evidence JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (discovery_item_id, intent_kind, query_hypothesis)
);
CREATE INDEX IF NOT EXISTS idx_discovery_intents_item ON discovery_intents(discovery_item_id);

CREATE TABLE IF NOT EXISTS discovery_validations (
  id TEXT PRIMARY KEY,
  discovery_intent_id TEXT NOT NULL REFERENCES discovery_intents(id) ON DELETE CASCADE,
  observed_date DATE NOT NULL DEFAULT CURRENT_DATE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  autocomplete_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (autocomplete_status IN ('OBSERVED','EMPTY','FAILED','UNKNOWN')),
  autocomplete_suggestions TEXT[] NOT NULL DEFAULT '{}',
  serp_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (serp_status IN ('OBSERVED','EMPTY','FAILED','UNKNOWN')),
  serp_result_count INTEGER,
  serp_weak_result_ratio NUMERIC(5,4),
  specialist_result_count INTEGER,
  authoritative_result_count INTEGER,
  supply_gap_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (supply_gap_status IN ('UNKNOWN','NO_DEDICATED_TOOL_OBSERVED','MIXED_SUPPLY','DEDICATED_SUPPLY')),
  supply_gap_note TEXT,
  evidence JSONB NOT NULL DEFAULT '{}',
  UNIQUE (discovery_intent_id, observed_date)
);
ALTER TABLE discovery_validations ADD COLUMN IF NOT EXISTS specialist_result_count INTEGER;
ALTER TABLE discovery_validations ADD COLUMN IF NOT EXISTS authoritative_result_count INTEGER;
ALTER TABLE discovery_validations ADD COLUMN IF NOT EXISTS supply_gap_status TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE discovery_validations ADD COLUMN IF NOT EXISTS supply_gap_note TEXT;

CREATE TABLE IF NOT EXISTS experiment_cards (
  id TEXT PRIMARY KEY,
  discovery_item_id TEXT REFERENCES discovery_items(id) ON DELETE CASCADE,
  discovery_intent_id TEXT REFERENCES discovery_intents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  core_job TEXT NOT NULL,
  recommended_page_shape TEXT NOT NULL,
  minimum_feature TEXT NOT NULL,
  success_signal TEXT NOT NULL,
  abandon_condition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','ACTIVE','COMPLETED','ABANDONED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experiment_cards_status ON experiment_cards(status, created_at DESC);

-- 8. 预测账本 (Append-Only Verdicts & Ledger Checkpoints)
CREATE TABLE IF NOT EXISTS verdicts (
  id TEXT PRIMARY KEY,                         -- vdt_
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  obs_date DATE NOT NULL,
  scoring_config_version TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('BUILD_NOW','EARLY_BET','WINDOW_CLOSING','WATCH','PASS')),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('FORMING','EARLY_WINDOW','CONTESTED','MATURE','DEAD')),
  d_basis_points INTEGER NOT NULL,
  m_basis_points INTEGER NOT NULL,
  w_basis_points INTEGER NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  input_snapshot_ids TEXT[] NOT NULL DEFAULT '{}',
  cited_evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  prev_hash CHAR(64) NOT NULL,
  row_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, obs_date)
);

-- 判定依据留存（06 §3 写入规则、03 §9 权威列）。存量行一律保持 NULL，绝不回填：
-- verdicts 是 append-only，回填既被触发器拒绝，也违背"记账不可事后重写"的设计本意。
--
-- flags 必须可空且不给默认值：'{}' 同时是"本期确实没有任何标志"的合法值，若给存量行
-- 填上 '{}'，界面会把"旧记录"读成"干净记录"。NULL 才是"早于该功能"的哨兵。
-- 判定遗留行的统一口径见 report.service / pipeline：hash_version = 1 OR explanation IS NULL。
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS raw_verdict TEXT;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS flags TEXT[];
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS explanation JSONB;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS features_hash CHAR(64);
-- hash_version: 1 = 原 11 字段集（存量行），2 = 11 字段 + 依据字段。默认 1 使存量行零改写。
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS hash_version SMALLINT NOT NULL DEFAULT 1;
-- 三轴档位。必须封存，不能从 opportunity_cards 现读：那是"当前"快照，拿它当历史
-- 会让 w_band 的时序永远是一条水平线，W_DROPPING 与窗口收窄的降级路径永不触发。
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS d_band TEXT;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS m_band TEXT;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS w_band TEXT;

-- v2 行必须携带依据。NOT VALID 只约束此后写入的行，不扫描也不改写存量行。
--
-- 先 DROP 再 ADD 而非 IF NOT EXISTS：约束的定义本身会演进（band 三列是后补的），
-- 沿用 IF NOT EXISTS 会让本地已建的旧定义静默留任。此刻没有任何 v2 行存在
-- （v2 写入路径尚未跑过），所以重建约束不会扫描到不合规的行。
ALTER TABLE verdicts DROP CONSTRAINT IF EXISTS verdicts_v2_requires_basis;
ALTER TABLE verdicts ADD CONSTRAINT verdicts_v2_requires_basis
  CHECK (
    hash_version = 1
    OR (
      raw_verdict IS NOT NULL
      AND explanation IS NOT NULL
      AND d_band IS NOT NULL
      AND m_band IS NOT NULL
      AND w_band IS NOT NULL
    )
  )
  NOT VALID;

CREATE TABLE IF NOT EXISTS prediction_episodes (
  id TEXT PRIMARY KEY,                         -- eps_
  verdict_id TEXT NOT NULL REFERENCES verdicts(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  published_verdict TEXT NOT NULL,
  predicted_at DATE NOT NULL,
  evaluated_30d_at DATE,
  outcome_30d TEXT CHECK (outcome_30d IN ('HIT','MISS','PENDING')),
  evaluated_60d_at DATE,
  outcome_60d TEXT CHECK (outcome_60d IN ('HIT','MISS','PENDING')),
  evaluated_90d_at DATE,
  outcome_90d TEXT CHECK (outcome_90d IN ('HIT','MISS','PENDING')),
  metrics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_checkpoints (
  id TEXT PRIMARY KEY,                         -- ckp_
  obs_date DATE UNIQUE NOT NULL,
  total_records INTEGER NOT NULL,
  merkle_root CHAR(64) NOT NULL,
  final_row_hash CHAR(64) NOT NULL,
  checkpoint_hash CHAR(64),
  -- 预留列，**当前没有任何签名实现**：pipeline 每次写入的都是字面量 'unsigned'，
  -- 全仓没有任何代码读过它。留着是为了将来接 KMS/离线私钥时不必改表，但请勿把它
  -- 当作签名读 —— 看到 'unsigned' 是常态，不是异常。真正在起作用的完整性锚点是
  -- merkle_root + checkpoint_hash 的逐日链，可由 /api/v1/public/verify-ledger 重算。
  signature TEXT NOT NULL DEFAULT '',
  -- 名字是错的：只由 DEFAULT NOW() 填充，即**写入时刻**，从没有任何代码在写入前
  -- 校验过什么。真实的校验按需发生（AdminService.getPipelineOverview 的
  -- recomputed 字段、TrackRecordService.verifyCheckpoint），结果不落库。
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ledger_checkpoints ADD COLUMN IF NOT EXISTS checkpoint_hash CHAR(64);

-- Append-only trigger for audit tables
CREATE OR REPLACE FUNCTION prevent_ledger_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Table % is strictly append-only. UPDATE and DELETE are prohibited.', TG_TABLE_NAME
  USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;

-- FOR EACH ROW, deliberately: a statement-level trigger also fires for the
-- internal `DELETE FROM verdicts WHERE opportunity_id = ...` that PostgreSQL
-- runs for the ON DELETE CASCADE, even when that cascade matches zero rows.
-- The whole statement then aborts, so `DELETE FROM opportunities` could never
-- succeed anywhere. Row-level keeps the guarantee that matters — no ledger row
-- can ever be modified or removed — without blocking no-op cascades.
DROP TRIGGER IF EXISTS trg_verdicts_append_only ON verdicts;
CREATE TRIGGER trg_verdicts_append_only
BEFORE UPDATE OR DELETE ON verdicts
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_modification();

DROP TRIGGER IF EXISTS trg_ledger_checkpoints_append_only ON ledger_checkpoints;
CREATE TRIGGER trg_ledger_checkpoints_append_only
BEFORE UPDATE OR DELETE ON ledger_checkpoints
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_modification();

-- 9. 机会研究报告 (Opportunity Reports)
CREATE TABLE IF NOT EXISTS opportunity_reports (
  id TEXT PRIMARY KEY,                         -- rpt_
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  verdict_id TEXT NOT NULL REFERENCES verdicts(id),
  snapshot_id TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-CN' CHECK (locale IN ('zh-CN','en-US')),
  status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('QUEUED','GENERATING','READY','FAILED')),
  schema_version TEXT NOT NULL DEFAULT '1.0',
  verdict TEXT NOT NULL,
  recommended_archetype TEXT NOT NULL,
  scores JSONB NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  content_markdown TEXT NOT NULL DEFAULT '',
  validation_report JSONB NOT NULL DEFAULT '{"passed": true}',
  stale BOOLEAN NOT NULL DEFAULT false,
  export_count INTEGER NOT NULL DEFAULT 0,
  last_exported_at TIMESTAMPTZ,
  generation_llm_run_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, user_id, snapshot_id, locale)
);
CREATE INDEX IF NOT EXISTS idx_opp_reports_user_opp ON opportunity_reports(user_id, opportunity_id);

-- 10. 关注与决策 (Watchlist & Decisions)
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,                         -- dcs_
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('GO','PASS')),
  verdict_id TEXT NOT NULL REFERENCES verdicts(id),
  reasons TEXT[] NOT NULL DEFAULT '{}',
  channel TEXT NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB','API')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/**
 * 决策的可验证性。
 *
 * verdict_row_hash 是关键的一列：它存的是被引用裁决行的**内容指纹**。仅存
 * verdict_id 只能证明"引用了某一行"，证明不了"引用的就是当时读到的那套理由"，
 * 而 verdict_id 本身可被重新指向。有了内容指纹，decisions 就挂进了 verdicts
 * 既有的哈希链 —— 而那条链有 ledger_checkpoints 的 Merkle 根做外部锚点，所以
 * 这条链路的完整性是可被第三方独立复算的，不依赖本表自己的 row_hash。
 *
 * row_hash 是决策行自身的内容指纹（见 DecisionService.calculateDecisionRowHash），
 * 用于发现内容漂移。它是**自指的**（指纹与内容同表），单独的证明力弱于
 * verdict_row_hash，要真正锚定需要将来把 decisions 也纳入 checkpoint。
 *
 * 这里**刻意没有 prev_hash**：决策是不同用户在不同时刻各自做出的行为，没有天然的
 * 全局顺序，硬造一条链只会把"不可伪造"降级成"按写入顺序不可伪造"。
 *
 * 两列都可空：存量行不回溯补算，与 verdicts 的 hash_version 处理一致 ——
 * 伪造历史哈希比承认早期行没有哈希更糟。新行由服务层一律写入。
 */
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS verdict_row_hash CHAR(64);
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS row_hash CHAR(64);

-- 决策记录的不可改写性。
--
-- 只挡 UPDATE，**刻意不挡 DELETE**。改写是真正的威胁：要伪造一条用户从未做出的
-- 授权，改 reasons 或 decision 就够了，删掉一行反而更容易被发现。而挡住 DELETE
-- 会关掉两件事：测试夹具的 `DELETE FROM users` 清理（这是唯一还在走 CASCADE 的
-- 路径），以及将来真正的擦除请求（GDPR 式硬删）—— 审计价值不足以换掉它们。
--
-- 注意"注销"当前**不是** CASCADE 路径：账户删除是软删（admin.service.ts 把
-- users.status 置为 DELETED 并终止会话），应用代码里没有 `DELETE FROM users`。
-- 因此 03 §18 承诺的"注销时把 decisions / projects 匿名化保留"实际上只做到了
-- "保留"：行还在，user_id 仍指向那个已软删的账号，并没有匿名化。要落地匿名化
-- 需要 UPDATE 这张表的 user_id，届时这条触发器要开一个受控口子（例如仅在对应
-- users 行已软删除时放行），而不是直接把触发器删掉。
--
-- 旧的 trg_decisions_append_only 是同一轮里先写成 UPDATE+DELETE 的版本，改名后
-- 必须显式清掉：DROP ... IF EXISTS 只清理新名字，旧触发器会留在已经跑过一遍的
-- 库上继续挡 DELETE。
DROP TRIGGER IF EXISTS trg_decisions_append_only ON decisions;
DROP TRIGGER IF EXISTS trg_decisions_no_update ON decisions;
CREATE TRIGGER trg_decisions_no_update
BEFORE UPDATE ON decisions
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_modification();

-- GO 的幂等性由服务层保证（同一 user/opportunity/verdict 只留一条）。这条索引
-- 是它的物理依据：客户端先记决策再建项目，两次调用之间失败时重试不应堆积 GO。
CREATE INDEX IF NOT EXISTS idx_decisions_go_lookup
  ON decisions(user_id, opportunity_id, verdict_id) WHERE decision = 'GO';

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,                         -- alr_
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('VERDICT_CHANGE','WINDOW_CLOSING','NEW_ENTRANT','KILL_CRITERIA')),
  frequency TEXT NOT NULL DEFAULT 'IMMEDIATE' CHECK (frequency IN ('IMMEDIATE','DAILY','WEEKLY')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 每日流水线只求值 VERDICT_CHANGE 与 WINDOW_CLOSING（见 services/src/alert-triggers.ts），
-- 而创建入口从前放行了全部四种，于是可能已经存在一批永远不响的规则。把它们置为
-- 停用：停用状态在规则列表里看得见，静默失效看不见。实现到位之后再让用户自行开启。
--
-- ⚠️ 这条语句是**临时补丁**，不是不变式。等 EVALUATED_RULE_TYPES 增加新类型时，
-- 必须把对应取值从这里删掉 —— 否则下一次迁移会把用户刚建好的规则又悄悄停用一次，
-- 正是这条语句想消灭的那类故障。四种都实现之后整条删除。
--
-- CHECK 约束**不跟着收窄**：schema.sql 是整体应用的，把取值删掉之后，用今天这份
-- schema 去恢复一份含历史行的生产转储会直接违反约束而中止。应用层的策略（拒绝创建）
-- 与 schema 层的取值集合是两件事，前者先收，后者等历史行清干净再收。
UPDATE alert_rules SET is_active = false
 WHERE is_active = true AND rule_type IN ('NEW_ENTRANT','KILL_CRITERIA');

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  alert_rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('EMAIL','WEBHOOK')),
  config JSONB NOT NULL DEFAULT '{}',
  is_verified BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,                         -- ntf_
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kill_criteria (
  id TEXT PRIMARY KEY,                         -- kc_
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  rule_code TEXT NOT NULL,
  predicate_dsl JSONB NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','TRIGGERED','DISMISSED')),
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. 项目与结果追踪 (Projects & GSC)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,                         -- prj_
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  decision_id TEXT REFERENCES decisions(id) ON DELETE CASCADE,
  project_kind TEXT NOT NULL DEFAULT 'FORMAL' CHECK (project_kind IN ('FORMAL','EXPERIMENT')),
  experiment_card_id TEXT REFERENCES experiment_cards(id) ON DELETE SET NULL,
  report_id TEXT REFERENCES opportunity_reports(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  domain TEXT,
  build_type TEXT NOT NULL DEFAULT 'LIGHTWEIGHT_TOOL',
  status TEXT NOT NULL DEFAULT 'IN_DEVELOPMENT' CHECK (status IN ('IN_DEVELOPMENT','LAUNCHED','ARCHIVED')),
  launch_date DATE,
  target_keywords TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE projects ALTER COLUMN opportunity_id DROP NOT NULL;
ALTER TABLE projects ALTER COLUMN decision_id DROP NOT NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_kind TEXT NOT NULL DEFAULT 'FORMAL';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS experiment_card_id TEXT REFERENCES experiment_cards(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_experiment_card ON projects(experiment_card_id) WHERE experiment_card_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_experiment_card
  ON projects(user_id, experiment_card_id) WHERE experiment_card_id IS NOT NULL;

-- 03 §9 的不变量 I6：一次 GO 决定至多对应一个项目。文档写了很久，物理约束一直
-- 缺位 —— 这一轮把决策变成项目唯一的授权凭据之后，"一条决策被两次立项"必须真的
-- 挡得住，否则 cite 就退化成弱引用。服务层在插入前给出可读的 409，这条索引是
-- 并发下的兜底。存量行若已违反，建索引会直接失败并指名重复的 decision_id。
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_decision
  ON projects(decision_id) WHERE decision_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gsc_connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  property_url TEXT,
  token_encrypted TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE gsc_connections ALTER COLUMN property_url DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gsc_connections_project ON gsc_connections(project_id);

CREATE TABLE IF NOT EXISTS gsc_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gsc_oauth_states_expiry ON gsc_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS gsc_metrics_weekly (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  average_position NUMERIC(5,2) NOT NULL DEFAULT 0.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, week_start_date)
);

CREATE TABLE IF NOT EXISTS gsc_metrics_weekly_detail (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  page_url TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL DEFAULT '',
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  average_position NUMERIC(5,2) NOT NULL DEFAULT 0.0,
  source TEXT NOT NULL DEFAULT 'GSC' CHECK (source IN ('GSC','SELF_REPORTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, week_start_date, page_url, query)
);

CREATE TABLE IF NOT EXISTS gsc_metrics_daily (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  observation_date DATE NOT NULL,
  page_url TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL DEFAULT '',
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  average_position NUMERIC(5,2) NOT NULL DEFAULT 0.0,
  source TEXT NOT NULL DEFAULT 'GSC' CHECK (source IN ('GSC','SELF_REPORTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, observation_date, page_url, query)
);

-- 12. 计费、套餐与配额 (Billing & Entitlements)
CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY,                       -- FREE, PRO, TEAM
  name TEXT NOT NULL,
  price_usd_monthly NUMERIC(10,2) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  entitlements JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep the launch entitlement contract aligned for existing installations.
-- Subscription snapshots remain unchanged; this only updates the current plan catalog.
UPDATE plans
SET price_usd_monthly = CASE code WHEN 'PRO' THEN 29.00 WHEN 'TEAM' THEN 149.00 ELSE price_usd_monthly END,
    entitlements = entitlements || CASE code
      WHEN 'FREE' THEN '{"generate_reports_monthly":1,"export_reports_monthly":0,"feed_delay_days":45,"api_access":false}'::jsonb
      WHEN 'PRO' THEN '{"generate_reports_monthly":30,"export_reports_monthly":30,"feed_delay_days":0,"api_access":false}'::jsonb
      WHEN 'TEAM' THEN '{"generate_reports_monthly":100,"export_reports_monthly":100,"feed_delay_days":0,"api_access":false}'::jsonb
      ELSE '{}'::jsonb
    END
WHERE code IN ('FREE', 'PRO', 'TEAM');

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES plans(code),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','TRIALING','PAST_DUE','CANCELED')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL,
  entitlements_snapshot JSONB NOT NULL DEFAULT '{}',
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_unique ON subscriptions(user_id);

-- Stripe linkage: required so lifecycle webhooks (cancellation, payment failure,
-- dispute, refund) can be attributed to a user without relying on metadata that
-- Stripe does not always propagate to the created subscription object.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription
  ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Webhook idempotency: each Stripe event id is applied at most once.
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL DEFAULT '',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB','API')),
  request_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, feature, request_id)
);

CREATE TABLE IF NOT EXISTS usage_counters (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  period_start DATE NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, feature, period_start)
);

-- 13. LLM 审计与成本
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  version INTEGER NOT NULL,
  template_hash CHAR(64) NOT NULL,
  output_schema_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  UNIQUE (key, version)
);

CREATE TABLE IF NOT EXISTS llm_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id TEXT NOT NULL REFERENCES prompts(id),
  model TEXT NOT NULL,
  input_hash CHAR(64) NOT NULL,
  output JSONB,
  schema_valid BOOLEAN NOT NULL DEFAULT true,
  citation_valid BOOLEAN DEFAULT true,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd NUMERIC(12,6) DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cost_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  cost_usd NUMERIC(10,6) NOT NULL,
  category TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. 公开页与审计
CREATE TABLE IF NOT EXISTS public_pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en-US',
  page_type TEXT NOT NULL CHECK (page_type IN ('OPPORTUNITY','TRACK_RECORD','METHODOLOGY','MARKET')),
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','UNPUBLISHED')),
  indexable BOOLEAN NOT NULL DEFAULT true,
  content JSONB NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slug, locale)
);

ALTER TABLE public_pages ADD COLUMN IF NOT EXISTS eligibility JSONB NOT NULL DEFAULT '{}';
ALTER TABLE public_pages ADD COLUMN IF NOT EXISTS quality_report JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('USER','ADMIN','SYSTEM')),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  ip INET,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. 管线执行审计与可观测性
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  obs_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED','ABORTED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  processed_opportunities INTEGER NOT NULL DEFAULT 0,
  merkle_root TEXT,
  alerts_triggered INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_obs_date ON pipeline_runs(obs_date);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);

-- 16. 评分轴取值域约束 (05 §4)
-- basis points 是 0-10000 的定点表达。没有这条约束时，一个越界的 Demand 得分
-- （历史上 attention 启发式的兜底表达式无上界）会被下游分档当作 HIGH 读取。
-- 用 DO 块保证重复执行幂等，并在已有脏数据时明确失败而不是静默跳过。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_cards_basis_points_range'
  ) THEN
    ALTER TABLE opportunity_cards
      ADD CONSTRAINT opportunity_cards_basis_points_range
      CHECK (
        d_basis_points BETWEEN 0 AND 10000
        AND m_basis_points BETWEEN 0 AND 10000
        AND w_basis_points BETWEEN 0 AND 10000
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verdicts_basis_points_range'
  ) THEN
    ALTER TABLE verdicts
      ADD CONSTRAINT verdicts_basis_points_range
      CHECK (
        d_basis_points BETWEEN 0 AND 10000
        AND m_basis_points BETWEEN 0 AND 10000
        AND w_basis_points BETWEEN 0 AND 10000
      );
  END IF;
END
$$;