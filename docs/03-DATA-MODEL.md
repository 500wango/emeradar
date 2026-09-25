# 03 — 数据模型

Status: Draft ｜ 依赖：00-INDEX（枚举）、02

## 1. 约定
- 数据库：PostgreSQL 15+；扩展 `citext`、`pg_trgm`、`pgcrypto`、`pg_partman`（用于月度分区表自动化维护，见 §5、§6）。
- **主键存储分两类（ADR-011，见 00 §5）**：
  1. **业务实体表**（用户可见、常出现在 URL / 支持工单 / 日志中，行数量级在千万以下）：`id text primary key`，格式见 00 §4.1（如 `opp_01J…`）。适用：`users` `opportunities` `entities` `queries` `projects` `opportunity_reports` `alert_rules` `kill_criteria` `scoring_configs` `prompts` `domains` `sources` `serp_snapshots` `commercial_targets` 等。
  2. **高频事实表**（预期年增千万级行，`id` 只作内部连接键、极少单独展示给用户）：`id uuid primary key default app_gen_uuid_v7()`。适用本文档中的：`evidence` `llm_runs` `cost_ledger` `raw_payloads` `commercial_snapshots`。`app_gen_uuid_v7()` 由应用层（`packages/db`）生成时间有序的 UUIDv7（而非 DB 端 `gen_random_uuid()` 生成的随机 UUIDv4，避免 B-tree 随机写入导致的页分裂），DB 侧仅声明列类型为 `uuid`。API 层通过 `packages/db` 的编解码助手对外仍展示为带前缀字符串（如 `evd_{base32(uuid)}`），保持 00 §4.1 对外契约不变；数据库内部存储与索引均为紧凑的 16 字节 `uuid`，不接受前缀字符串作为存储格式。
  3. `serp_results` `autocomplete_observations` `gsc_metrics_weekly` 等使用**复合主键**（业务列组成），不设代理 `id`，天然避免此问题。
- 时间：`timestamptz`（UTC）；`obs_date` 为 `date`（UTC）。
- 每张表默认含 `created_at timestamptz not null default now()`，下文省略。
- **DDL 是约束性定义**：实现可补充列与索引，但不得削弱约束与不变量（§17）。
- 枚举以 `check` 约束实现，取值见 00 §4.3。
- 下文 DDL 中为可读性，`evidence` `llm_runs` `cost_ledger` `raw_payloads` `commercial_snapshots` 的 `id` 列仍写作 `text primary key` 占位；实现时按本节规则改为 `uuid primary key`，FK 引用方同步改为 `uuid`（具体见各表旁注）。

## 2. 身份、偏好与认证（Auth.js / NextAuth v5 自建认证体系）

```sql
create table users (
  id text primary key,
  email citext not null unique,
  email_verified_at timestamptz,
  display_name text,
  avatar_url text,
  ui_locale text not null default 'en-US' check (ui_locale in ('zh-CN','en-US')),
  role text not null default 'USER' check (role in ('USER','ANALYST','ADMIN','SUPPORT')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','DELETED')),
  deleted_at timestamptz
);

-- Auth.js (NextAuth v5) 认证适配器标准表
create table accounts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  type text not null,
  provider text not null,
  provider_account_id text not null,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  unique (provider, provider_account_id)
);

create table sessions (
  id text primary key,
  session_token text not null unique,
  user_id text not null references users(id) on delete cascade,
  expires timestamptz not null
);

create table verification_tokens (
  identifier text not null,
  token text not null,
  expires timestamptz not null,
  primary key (identifier, token)
);

create table user_preferences (
  user_id text primary key references users(id),
  build_types text[] not null default '{}',
  topics text[] not null default '{}',
  markets text[] not null default '{US}',                 -- market_country
  research_languages text[] not null default '{en-US}',   -- BCP 47
  monetization_routes text[] not null default '{}',
  time_budget text check (time_budget in ('WEEKEND','TWO_WEEKS','ONE_MONTH')),
  updated_at timestamptz not null default now()
);

create table api_keys (
  id text primary key,
  user_id text not null references users(id),
  name text not null,
  key_prefix text not null,
  key_hash text not null,                    -- 仅存哈希
  scopes text[] not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);
```

## 3. 计费与用量

```sql
create table plans (
  code text not null,                          -- FREE / PRO / TEAM
  version integer not null default 1,
  entitlements jsonb not null,                -- 结构见 13 §3.2
  active boolean not null default true,        -- 仅最新 version 可为新订阅使用；旧 version 保留供快照引用
  effective_at timestamptz not null default now(),
  primary key (code, version)
);
create index plans_active_idx on plans (code) where active;

create table subscriptions (
  id text primary key,
  user_id text not null references users(id),
  plan_code text not null,
  plan_version integer not null,
  entitlements_snapshot jsonb not null,        -- 订阅时刻的权益快照（13 §3.3），当期内不受配置变更影响
  foreign key (plan_code, plan_version) references plans(code, version),
  status text not null check (status in ('TRIALING','ACTIVE','PAST_DUE','CANCELED','PAUSED')),
  provider text not null,
  provider_subscription_id text not null unique,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false
);

create table usage_events (
  id text primary key,
  user_id text not null references users(id),
  feature text not null,
  units integer not null,
  channel text not null check (channel in ('WEB','API')),
  request_id text not null,
  occurred_at timestamptz not null default now(),
  unique (user_id, feature, request_id)       -- 幂等
);

create table usage_counters (
  user_id text not null references users(id),
  feature text not null,
  period_start date not null,
  used integer not null default 0,
  primary key (user_id, feature, period_start)
);
```

## 4. 数据源与运行

```sql
create table sources (
  id text primary key,                        -- 如 src_autocomplete
  code text not null unique,
  source_class text not null,                 -- AUTOCOMPLETE / SERP / ATTENTION / COMMERCIAL / GSC / OTHER
  access_method text not null check (access_method in ('OFFICIAL_API','LICENSED_API','OWN_CRAWL','USER_OAUTH')),
  tos_risk text not null check (tos_risk in ('LOW','MEDIUM','HIGH')),
  legal_status text not null default 'UNREVIEWED' check (legal_status in ('UNREVIEWED','APPROVED','APPROVED_WITH_CONDITIONS','BLOCKED')),
  enabled boolean not null default false,
  config jsonb not null default '{}'
);

create table collector_runs (
  id text primary key,
  source_id text not null references sources(id),
  collector_version text not null,
  obs_date date not null,
  scope jsonb not null,                       -- 批次范围
  status text not null check (status in ('RUNNING','SUCCEEDED','PARTIAL','FAILED')),
  items_ok integer not null default 0,
  items_failed integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  started_at timestamptz not null,
  finished_at timestamptz,
  error jsonb
);

create table raw_payloads (
  id text primary key,                        -- 存储：uuid（见 §1 高频事实表规则）
  run_id text not null references collector_runs(id),
  storage_key text not null,
  sha256 char(64) not null,
  bytes integer not null,
  content_type text not null,
  retained_until date,                        -- null = 永久（账本涉及）
  unique (sha256, storage_key)
);

create table cost_ledger (
  id text primary key,                        -- 存储：uuid（见 §1 高频事实表规则）
  run_id text references collector_runs(id),
  source_id text not null references sources(id),
  obs_date date not null,
  opportunity_id text,
  query_id text,
  units numeric not null,
  cost_usd numeric(12,6) not null
);
create index on cost_ledger (obs_date, source_id);
```

## 5. 实体与 Query

```sql
create table entities (
  id text primary key,
  canonical_name text not null,
  slug text not null unique,
  entity_type text not null default 'UNKNOWN'
);
create table entity_aliases (
  entity_id text not null references entities(id),
  alias text not null,
  language text,
  primary key (entity_id, alias)
);

create table queries (
  id text primary key,
  text text not null,                          -- 原文，保留
  text_normalized text not null,               -- 规则见 14 §6
  market_country char(2) not null,
  research_language text not null,
  first_observed_at timestamptz not null,      -- 首次被本系统观测
  last_observed_at timestamptz not null,
  tier text not null default 'C' check (tier in ('A','B','C')),
  status text not null default 'ACTIVE',
  unique (text_normalized, market_country, research_language)
);
create index queries_trgm on queries using gin (text_normalized gin_trgm_ops);

create table autocomplete_observations (
  obs_date date not null,
  seed_query_id text not null references queries(id),
  suggestion_query_id text not null references queries(id),
  rank smallint not null,
  source_id text not null references sources(id),
  run_id text not null references collector_runs(id),
  primary key (obs_date, seed_query_id, suggestion_query_id)
) partition by range (obs_date);
```

## 6. SERP

```sql
create table domains (
  id text primary key,
  host text not null unique,                   -- registrable domain (eTLD+1)
  authority_class text not null default 'UNKNOWN'
    check (authority_class in ('OFFICIAL','MAJOR_MEDIA','PLATFORM_UGC','SPECIALIST','SMALL_SITE','UNKNOWN')),
  first_observed_at timestamptz not null
);

create table serp_snapshots (
  id text primary key,                         -- snp_
  query_id text not null references queries(id),
  obs_date date not null,
  source_id text not null references sources(id),
  run_id text not null references collector_runs(id),
  raw_payload_id text references raw_payloads(id),
  fetched_at timestamptz not null,
  result_count smallint not null,
  serp_features jsonb not null default '[]',
  unique (query_id, obs_date, source_id)
);

create table serp_results (
  obs_date date not null,                       -- 分区键：与 serp_snapshots.obs_date 一致，写入时冗余
  snapshot_id text not null references serp_snapshots(id),
  rank smallint not null,
  url text not null,
  domain_id text not null references domains(id),
  title text,
  snippet text,
  result_type text not null default 'UNCLASSIFIED',
    -- SPECIALIST / OFFICIAL / EDITORIAL_MEDIA / LISTICLE_AFFILIATE / DIRECTORY / UGC_THREAD / QA / VIDEO / DOC / THIN_PAGE / OFF_TOPIC / UNCLASSIFIED
  relevance numeric(3,2),
  age_days integer,
  primary key (obs_date, snapshot_id, rank)
) partition by range (obs_date);          -- 月度分区；查询按 obs_date 过滤可分区裁剪
create index serp_results_snapshot_idx on serp_results (snapshot_id);

-- pg_partman 自动分区维护配置（按月自动预建未来 2 个月子分区，避免跨月写入雪崩）
select partman.create_parent(
  p_parent_table => 'public.autocomplete_observations',
  p_control => 'obs_date',
  p_type => 'range',
  p_interval => '1 month',
  p_premake => 2
);

select partman.create_parent(
  p_parent_table => 'public.serp_results',
  p_control => 'obs_date',
  p_type => 'range',
  p_interval => '1 month',
  p_premake => 2
);
```

## 7. Evidence 与商业信号

```sql
create table evidence (
  id text primary key,                         -- 存储：uuid（见 §1 高频事实表规则）
  opportunity_id text,
  subject_type text not null check (subject_type in ('QUERY','DOMAIN','OPPORTUNITY','ENTITY','PROJECT')),
  subject_id text not null,
  evidence_class text not null check (evidence_class in ('OBSERVED','SELF_REPORTED','THIRD_PARTY_ESTIMATE','INFERRED')),
  evidence_type text not null,                 -- 枚举见 07 §3
  source_id text not null references sources(id),
  run_id text references collector_runs(id),
  observed_at timestamptz not null,
  obs_date date not null,
  payload jsonb not null,
  snapshot_refs jsonb not null default '[]',
  supersedes_id text references evidence(id),  -- 存储：uuid，与 evidence.id 同型
  label_text text                              -- 显式标注文本（self-reported / estimate 必填）
);
create index on evidence (opportunity_id, obs_date);
create index on evidence (subject_type, subject_id);
-- 应用角色无 UPDATE/DELETE 权限（§17）

create table evidence_contradictions (
  id text primary key,
  evidence_a text not null references evidence(id),  -- 存储：uuid，与 evidence.id 同型
  evidence_b text not null references evidence(id),  -- 存储：uuid，与 evidence.id 同型
  kind text not null,
  detected_at timestamptz not null default now()
);

create table commercial_targets (
  id text primary key,
  opportunity_id text not null references opportunities(id),
  domain_id text not null references domains(id),
  validation_level text not null check (validation_level in ('DIRECT','CATEGORY','ANALOG')),
  discovered_via text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','BLOCKED_DMCA','INACTIVE')),
  active boolean not null default true,        -- status = 'ACTIVE' 的只读兼容映射
  unique (opportunity_id, domain_id)
);

create table commercial_snapshots (
  id text primary key,                         -- 存储：uuid（见 §1 高频事实表规则）
  domain_id text not null references domains(id),
  obs_date date not null,
  page_type text not null check (page_type in ('PRICING','CHECKOUT','HOME','COUNTER','OTHER')),
  url text not null,
  fetch_tier text not null check (fetch_tier in ('STATIC','HEADLESS')),   -- 04 §4.2
  raw_payload_id text references raw_payloads(id),
  extracted jsonb,
  extraction_llm_run_id text,
  unique (domain_id, obs_date, url)
);
```

## 8. Opportunity 与评分

```sql
create table opportunities (
  id text primary key,
  entity_id text references entities(id),
  market_country char(2) not null,
  research_language text not null,
  slug text not null unique,
  title_original text not null,
  status text not null default 'CANDIDATE' check (status in ('CANDIDATE','TRACKED','ARCHIVED')),
  tier text check (tier in ('A','B')),
  first_observed_at timestamptz not null,
  tracked_since date
  -- 注意：不存 primary_query_id。主 query 由 opportunity_queries(role='PRIMARY') 唯一定义，
  -- 避免双重事实源（见 §17 I8）。应用层通过视图 opportunities_with_primary_query 读取。
);

create table opportunity_queries (
  opportunity_id text not null references opportunities(id),
  query_id text not null references queries(id),
  role text not null check (role in ('PRIMARY','CLUSTER')),
  added_at timestamptz not null default now(),
  primary key (opportunity_id, query_id)
);
-- 每个机会恰好一个 PRIMARY query（不多不少），由部分唯一索引强制“至多一个”，
-- “至少一个”由应用层在创建机会的同一事务中保证，并由夜间一致性检查兜底。
create unique index opportunity_queries_one_primary
  on opportunity_queries (opportunity_id) where role = 'PRIMARY';

-- 只读派生视图，供应用层统一取用，禁止任何代码路径绕过它直接拼接主 query
create view opportunities_with_primary_query as
  select o.*, oq.query_id as primary_query_id
  from opportunities o
  join opportunity_queries oq
    on oq.opportunity_id = o.id and oq.role = 'PRIMARY';

create table scoring_configs (
  version text primary key,                    -- sc-1.0.0
  status text not null check (status in ('DRAFT','SHADOW','ACTIVE','RETIRED')),
  config jsonb not null,
  config_hash char(64) not null,
  created_by text not null,
  approved_by text,
  activated_at timestamptz
);
-- 一旦 status != DRAFT，config 不可修改（触发器）

create table axis_features (
  opportunity_id text not null references opportunities(id),
  obs_date date not null,
  feature_set_version text not null,
  features jsonb not null,
  input_snapshot_ids jsonb not null,
  features_hash char(64) not null,
  primary key (opportunity_id, obs_date, feature_set_version)
);

create table crowding_daily (
  opportunity_id text not null references opportunities(id),
  obs_date date not null,
  go_users_14d integer not null,
  crowding_index numeric(5,2) not null,
  primary key (opportunity_id, obs_date)
);

-- 推荐层（05 §11）：不进账本，但每日落库以便复现
create table opportunity_recommendations (
  opportunity_id text not null references opportunities(id),
  obs_date date not null,
  scoring_config_version text not null references scoring_configs(version),
  build_types jsonb not null,        -- 排名、rationale_rule_ids、complexity、content_burden、execution_class
  routes jsonb not null,             -- 各 monetization_route 的 grade 与 rationale_rule_ids
  execution_class text not null check (execution_class in ('S','M','L')),
  input_hash char(64) not null,
  primary key (opportunity_id, obs_date)
);
```

## 9. Verdict 账本

```sql
-- S5（可并发、多 Worker 分片）写入暂存表，不参与哈希链，无排序约束
create table verdicts_pending (
  opportunity_id text not null references opportunities(id),
  obs_date date not null,
  scoring_config_version text not null references scoring_configs(version),
  computed jsonb not null,                     -- 与 verdicts 各字段一一对应的中间结果
  computed_at timestamptz not null default now(),
  primary key (opportunity_id, obs_date)
);
-- S6（单 Worker、pg_advisory_lock 串行执行）消费 verdicts_pending，按 opportunity_id 排序后
-- 串行计算哈希链并批量写入 verdicts，成功后清空当日 verdicts_pending（02 §5 ADR-014）

create table verdicts (
  id text primary key,                         -- vdt_
  opportunity_id text not null references opportunities(id),
  obs_date date not null,
  scoring_config_version text not null references scoring_configs(version),
  d_band text not null, m_band text not null, w_band text not null,
  confidence text not null,
  d_score numeric(5,2), m_score numeric(5,2), w_score numeric(5,2),
  confidence_score numeric(4,3),
  raw_verdict text not null,                   -- 去抖前
  verdict text not null,                       -- 发布值（去抖后）
  lifecycle text not null,
  flags text[] not null default '{}',
  input_snapshot_ids jsonb not null,
  features_hash char(64) not null,
  explanation jsonb not null,                  -- 规则命中轨迹
  is_override boolean not null default false,
  supersedes_id text references verdicts(id),
  override_reason text,
  actor_id text,
  prev_hash char(64) not null,
  row_hash char(64) not null,
  computed_at timestamptz not null default now()
);
create unique index verdicts_one_system_row
  on verdicts (opportunity_id, obs_date) where is_override = false;
create index on verdicts (obs_date, verdict);

create table verdicts_shadow (like verdicts including all);   -- SHADOW 配置输出，不进账本

create table ledger_checkpoints (
  obs_date date primary key,
  row_count integer not null,
  merkle_root char(64) not null,
  prev_checkpoint_hash char(64) not null,
  checkpoint_hash char(64) not null,
  external_timestamp jsonb,                    -- 可选：RFC 3161 回执
  published_at timestamptz
);

create table lifecycle_transitions (
  id text primary key,
  opportunity_id text not null references opportunities(id),
  from_state text, to_state text not null,
  rule_id text not null,
  obs_date date not null,
  verdict_id text not null references verdicts(id),
  evidence_ids text[] not null default '{}'
);

create table outcome_evaluations (
  id text primary key,
  verdict_id text not null references verdicts(id),
  episode_id text not null,
  horizon_days smallint not null check (horizon_days in (30,60,90)),
  eval_spec_version text not null,
  events jsonb not null,
  evaluated_at timestamptz not null default now(),
  unique (verdict_id, horizon_days, eval_spec_version)
);
```

## 10. 用户行为

```sql
create table watchlist (
  user_id text not null references users(id),
  opportunity_id text not null references opportunities(id),
  created_at timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);

create table decisions (
  id text primary key,
  user_id text not null references users(id),
  opportunity_id text not null references opportunities(id),
  decision text not null check (decision in ('GO','PASS')),
  reason_code text not null,
  note text,
  verdict_id_at_decision text not null references verdicts(id),
  decided_at timestamptz not null default now()
);
create index on decisions (user_id, opportunity_id, decided_at desc);
```

## 11. 告警

```sql
create table notification_channels (
  id text primary key,
  user_id text not null references users(id),
  channel_type text not null check (channel_type in ('EMAIL','WEBHOOK')),
  config_encrypted bytea not null,
  verified_at timestamptz,
  disabled_at timestamptz
);

create table kill_criteria (
  id text primary key,                         -- kc_
  opportunity_id text not null references opportunities(id),
  user_id text references users(id),           -- null = 系统建议模板
  predicate jsonb not null,                    -- DSL 见 12 §5
  origin text not null check (origin in ('SYSTEM','USER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','TRIGGERED','DISABLED'))
);

create table alert_rules (
  id text primary key,
  user_id text not null references users(id),
  rule_type text not null,                     -- 见 12 §3
  params jsonb not null default '{}',
  channel_ids text[] not null default '{}',
  enabled boolean not null default true
);

create table alert_events (
  id text primary key,
  dedupe_key text not null unique,
  user_id text not null references users(id),
  opportunity_id text references opportunities(id),
  project_id text references projects(id),
  rule_id text references alert_rules(id),
  trigger jsonb not null,
  obs_date date not null
);

create table deliveries (
  id text primary key,                         -- ntf_
  alert_event_id text not null references alert_events(id),
  channel_id text not null references notification_channels(id),
  status text not null check (status in ('PENDING','SENT','FAILED','DEAD')),
  attempts smallint not null default 0,
  last_error text,
  delivered_at timestamptz
);
```

## 12. Project 与 GSC

```sql
create table projects (
  id text primary key,                         -- prj_
  user_id text not null references users(id),
  opportunity_id text not null references opportunities(id),
  decision_id text not null references decisions(id),
  build_type text not null,
  domain text,
  launch_date date,
  target_keywords text[] not null default '{}',
  status text not null default 'PLANNED' check (status in ('PLANNED','BUILDING','LAUNCHED','ABANDONED')),
  outcome_status text not null default 'UNKNOWN'
    check (outcome_status in ('UNKNOWN','NO_TRACTION','EARLY_TRACTION','TRACTION'))
);

create table project_pages (
  project_id text not null references projects(id),
  url text not null,
  role text,
  primary key (project_id, url)
);

create table gsc_connections (
  id text primary key,
  project_id text not null references projects(id),
  property text not null,
  token_encrypted bytea not null,
  status text not null check (status in ('ACTIVE','REVOKED','ERROR')),
  last_synced_at timestamptz
);

create table gsc_metrics_weekly (
  project_id text not null references projects(id),
  week_start date not null,
  page_url text not null default '',
  query text not null default '',
  impressions integer not null, clicks integer not null,
  avg_position numeric(6,2),
  primary key (project_id, week_start, page_url, query)
);

create table project_revenue_reports (            -- 用户自填，恒为 SELF_REPORTED
  id text primary key,
  project_id text not null references projects(id),
  period_start date not null, period_end date not null,
  amount_usd numeric(12,2) not null
);
```

## 13. 机会研究报告（Opportunity Reports）

```sql
create table opportunity_reports (
  id text primary key,                         -- rpt_ (text ULID)
  opportunity_id text not null references opportunities(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  version integer not null default 1,
  verdict_id text not null references verdicts(id),   -- 生成时依据
  snapshot_id text not null,                           -- 关联的当日快照
  locale text not null check (locale in ('zh-CN','en-US')),
  status text not null check (status in ('QUEUED','GENERATING','READY','FAILED')),
  schema_version text not null default '1.0',
  verdict text not null,
  recommended_archetype text not null,
  scores jsonb not null,                               -- 冻结的 d/m/w 基点得分快照
  content jsonb,                                       -- 完整结构化 JSON（6 大板块）
  content_markdown text,                               -- 预渲染的 GFM Markdown（便于快速下载与复制）
  validation_report jsonb,
  stale boolean not null default false,
  export_count integer not null default 0,
  last_exported_at timestamptz,
  generation_llm_run_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, user_id, snapshot_id, locale)
);
create index idx_opp_reports_user_opp on opportunity_reports(user_id, opportunity_id);
```

## 14. LLM 注册与运行

```sql
create table prompts (
  id text primary key,
  key text not null,
  version integer not null,
  template_hash char(64) not null,
  output_schema_ref text not null,
  status text not null check (status in ('DRAFT','ACTIVE','RETIRED')),
  unique (key, version)
);

create table llm_runs (
  id text primary key,                         -- 存储：uuid（见 §1 高频事实表规则）
  prompt_id text not null references prompts(id),
  model text not null,
  input_hash char(64) not null,
  output jsonb,
  schema_valid boolean not null,
  citation_valid boolean,
  input_tokens integer, output_tokens integer,
  cost_usd numeric(12,6),
  latency_ms integer,
  status text not null,
  created_at timestamptz not null default now()
);
create index on llm_runs (prompt_id, input_hash);   -- 缓存命中
```

## 15. 本地化与公开页

```sql
create table localized_content (
  id text primary key,
  subject_type text not null,
  subject_id text not null,
  field text not null,
  locale text not null,
  text text not null,
  source_locale text not null,
  source_hash char(64) not null,               -- 源内容变化则失效
  provenance jsonb not null,                   -- model / prompt_version / llm_run_id
  unique (subject_type, subject_id, field, locale)
);

create table public_pages (
  id text primary key,                         -- pgm_
  page_type text not null
    check (page_type in ('OPPORTUNITY','MARKET','TREND_ENTITY','REPLAY','REPORT','COMPARE','TRACK_RECORD')),
  slug text not null,
  locale text not null,
  opportunity_id text references opportunities(id),
  status text not null check (status in ('DRAFT','PUBLISHED','UNPUBLISHED')),
  indexable boolean not null default false,
  eligibility jsonb not null,
  quality_report jsonb not null,
  canonical_url text,
  published_at timestamptz,
  unique (slug, locale)
);
```

## 16. 审计

```sql
create table audit_log (
  id text primary key,
  actor_id text,
  actor_type text not null check (actor_type in ('USER','ADMIN','SYSTEM')),
  action text not null,
  target_type text, target_id text,
  payload jsonb,
  ip inet,
  occurred_at timestamptz not null default now()
);
-- append-only
```

## 17. 数据库不变量（必须由 DB / 迁移测试强制）

| # | 不变量 | 强制方式 |
|---|--------|----------|
| I1 | `verdicts`、`evidence`、快照表、`ledger_checkpoints`、`audit_log` 对应用角色无 UPDATE / DELETE | 角色权限 + 触发器 |
| I2 | 同一 `(opportunity_id, obs_date)` 至多一条系统 Verdict | 部分唯一索引 |
| I3 | `scoring_configs.status != 'DRAFT'` 后 `config` 不可变 | 触发器 |
| I4 | 每个 Verdict 的 `input_snapshot_ids` 引用的快照必须存在 | 写入前校验 + 夜间一致性检查 |
| I5 | `evidence_class IN ('SELF_REPORTED','THIRD_PARTY_ESTIMATE')` 必须有 `label_text` | check 约束 |
| I6 | 一次 GO 决定 → 至多一个 Project（同一 `decision_id`） | 唯一索引 |
| I7 | `row_hash = sha256(prev_hash ‖ canonical_json(row))` 可在任意时刻重验 | 06 的验证任务 |
| I8 | 每个 `status != 'CANDIDATE'` 的机会恰有 1 条 `opportunity_queries(role='PRIMARY')` | 创建 / 升级机会的事务内保证 + `opportunity_queries_one_primary` 部分唯一索引（防多）+ 夜间一致性检查（防零：扫描无 PRIMARY 的 TRACKED/ARCHIVED 机会并告警） |
| I9 | 高频事实表（§1 规则 2）的 `id` 列为原生 `uuid`；对外 API 一律经 `packages/db` 编解码为带前缀字符串，任何代码不得绕过该助手拼接前缀 | 代码评审 + 类型层禁止裸 `string` 传参给这些表的 id 字段（使用 branded type） |

## 18. 保留与删除
- 用户删除账户：软删除 `users`；级联删除 `user_preferences`、`api_keys`、`notification_channels`、`opportunity_reports`、`gsc_connections`、令牌；`decisions` 与 `projects` 匿名化保留（去除 `user_id` 关联），因其构成校准数据；`audit_log` 中的 `actor_id` 替换为哈希。
- 账本与快照不含个人数据，永久保留。
