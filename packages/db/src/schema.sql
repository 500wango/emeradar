-- ============================================================================
-- Emeradar PostgreSQL 15+ Complete Schema Definition
-- Based on 03-DATA-MODEL.md and related specifications
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  signature TEXT NOT NULL DEFAULT '',
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ledger_checkpoints ADD COLUMN IF NOT EXISTS checkpoint_hash CHAR(64);

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

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,                         -- alr_
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('VERDICT_CHANGE','WINDOW_CLOSING','NEW_ENTRANT','KILL_CRITERIA')),
  frequency TEXT NOT NULL DEFAULT 'IMMEDIATE' CHECK (frequency IN ('IMMEDIATE','DAILY','WEEKLY')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
