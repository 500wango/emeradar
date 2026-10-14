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

-- 反滥用（13 §9、PRD F14）。四张表共同支撑「Free 终身仅 1 次实时初筛」不被批量小号刷穿。
create table email_identities (
  user_id text primary key references users(id) on delete cascade,
  canonical_email citext not null unique,    -- 归一化结果：小写 + 剥离 Gmail 的 "+别名" 与 "."
  raw_email citext not null,                 -- 注册原文，仅审计与申诉用
  normalized_at timestamptz not null default now()
);
-- 唯一约束是兜底而非唯一防线：归一化在应用层做（13 §9），这里防止并发注册绕过。
-- 非 Gmail 域只做小写归一，不剥离点号——点号在多数邮箱里是有意义的字符。

create table disposable_email_domains (
  domain citext primary key,                 -- 一次性/临时邮箱域，注册时拒绝
  source text not null,
  added_at timestamptz not null default now()
);

create table device_fingerprints (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  fingerprint_hash char(64) not null,        -- 浏览器指纹的加盐哈希；不存原始特征值
  ip_hash char(64) not null,                 -- 客户端 IP 的加盐哈希
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (fingerprint_hash, user_id)
);

create table lifetime_scan_grants (
  id text primary key,
  -- 可空且 SET NULL：注销时**保留**指纹哈希但切断与账号的关联。若随账号级联删除，
  -- 注销再注册就能再领一次终身免费初筛，这条反滥用规则会自我抵消。口径与隐私说明见 §18。
  user_id text references users(id) on delete set null,
  fingerprint_hash char(64),
  ip_hash char(64),
  granted_at timestamptz not null default now()
);
create index lifetime_scan_grants_fp on lifetime_scan_grants (fingerprint_hash, granted_at desc);
create index lifetime_scan_grants_ip on lifetime_scan_grants (ip_hash, granted_at desc);
-- 这张表是「同一设备/IP 30 天内最多触发 1 次免费初筛」的**判定依据**，而不是
-- usage_counters 的终身计数：后者只防同一账号重复领取，防不住换号重领。
-- fingerprint_hash / ip_hash 可空：两者都缺失时该行不参与跨账号判定（宁可放行一次，
-- 也不因为拿不到指纹而永久拒绝一个真实用户）。
```

## 3. 计费与用量

```sql
create table plans (
  code text not null,                          -- FREE / PRO（TEAM 为历史兼容值，不在结账页出现；见 13 §3.1）
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
  -- 计费周期：季度即主推的 Builder Pass（PRD §8.1），它不是独立 plan_code，
  -- 而是 PRO 权益在 QUARTER 计费间隔下的售卖方式，避免同一份权益出现两个真源。
  billing_interval text not null default 'MONTH' check (billing_interval in ('MONTH','QUARTER','YEAR')),
  -- 一次性买断的 PRO 权益（Founding Lifetime）不产生续费事件，用此列区分（13 §4.4）。
  -- Stealth Buyout 不在这张表：它买的不是订阅权益，见 §12 stealth_locks。
  purchase_kind text not null default 'SUBSCRIPTION' check (purchase_kind in ('SUBSCRIPTION','FOUNDING_LIFETIME')),
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
-- 「终身额度」（Free 的 1 次实时初筛）用**固定哨兵日期** `1970-01-01` 表达 period_start，
-- 而不是新增一张表：这样终身额度与周期额度共用同一套原子预占逻辑（13 §4.1），
-- 不必为一个 feature 写第二份并发控制。哨兵日期由常量 `LIFETIME_PERIOD_START` 提供。
--
-- 跨月累计（Rollover，PRD §8.1）不改本表结构：周期结束时的剩余额度写入
-- `usage_carryovers`，下一周期读取时叠加。
create table usage_carryovers (
  user_id text not null references users(id),
  feature text not null,
  from_period_start date not null,
  units integer not null check (units > 0),
  carried_at timestamptz not null default now(),
  consumed_in_period date,                     -- 已被哪个周期消费；NULL 表示仍可叠加
  primary key (user_id, feature, from_period_start)
);
-- 只对配置了 `rollover: true` 的 feature 生效（首发仅 Pro 的原子立项导出）。
-- 每次结转都留一行，使"未用完的额度去哪了"可被逐笔回答，而不是靠一个会漂移的余额数字。
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
  -- 新晋赢家（PROVEN_NEW_ENTRANT，PRD §1.7.3）需要"上线不满 6 个月"这个判据。
  -- 该判据**不是**本系统的观测结果，必须连同来源一起存，且来源为空时不得推断：
  established_at date,                         -- 可考证的上线/注册时间
  established_source text,                     -- 判定该时间的依据（注册记录 / 首次索引 / 商店上架）
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
  depth smallint not null default 100,         -- 采集深度；首发固定 100（一鱼多吃，PRD F1.1）
  result_count smallint not null,              -- 实际返回条数，可能 < depth
  serp_features jsonb not null default '[]',
  unique (query_id, obs_date, source_id)
);
-- depth = 100 的用途分工（PRD F1.1）：rank 1–10 参与 SERP 弱点计算（05 §3.3），
-- rank 11–100 只用于在内存中匹配已核验项目的域名/商店链接（§12 project_serp_rankings），
-- **不为追踪项目单独发起任何 SERP 请求**。因此 11–100 不额外产生采集成本。

create table serp_results (
  obs_date date not null,                       -- 分区键：与 serp_snapshots.obs_date 一致，写入时冗余
  snapshot_id text not null references serp_snapshots(id),
  rank smallint not null,                       -- 1–100
  url text not null,
  domain_id text not null references domains(id),
  title text,
  snippet text,
  -- **入库时冻结的分类标签（ADR-020）**：由 LLM 在采集入库阶段一次性生成，此后永不重算。
  -- 评分与历史重算只读这一列，绝不在重算路径重新分类——否则同一快照集合会因模型版本
  -- 漂移得出不同分数，"100% 可重算"（PRD P7）与账本上封存的判据都会失效。
  result_type text not null default 'UNCLASSIFIED',
    -- SPECIALIST / OFFICIAL / EDITORIAL_MEDIA / LISTICLE_AFFILIATE / DIRECTORY / UGC_THREAD / QA / VIDEO / DOC / THIN_PAGE / OFF_TOPIC / UNCLASSIFIED
  label_frozen_at timestamptz,                  -- 分类标签写入时刻；NULL 表示尚未分类（该行不得参与评分）
  classifier_run_id text references llm_runs(id),
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
  slots_claimed_total integer not null,        -- Σ 全部形态中 slot_state = 'CLAIMED' 的数量
  slots_capacity_total integer not null,       -- Σ 全部形态的 capacity（≤ max_capacity_total）
  crowding_index numeric(5,2) not null,
  primary key (opportunity_id, obs_date)
);
-- 取代早期的 go_users_14d：拥挤度按**当前占用**而非"14 天内点过 GO 的人数"计算，
-- 因为 7 天质押逾期会释放槽位，而"点过 GO"的计数会把已释放的人永久算作占用。

-- 认领槽位（ADR-018、05 §5.1、PRD §1.7 第 5 条）。按 Build Archetype 切分，是一条机会可以有
-- 多个"队"的原因：不同形态的认领者互不挤占，避免所有订阅者做同一个同质竞品。
create table opportunity_slots (
  opportunity_id text not null references opportunities(id) on delete cascade,
  archetype text not null,                     -- 00 §4.3 build_type
  capacity integer not null check (capacity > 0),
  claimed integer not null default 0 check (claimed >= 0 and claimed <= capacity),
  updated_at timestamptz not null default now(),
  primary key (opportunity_id, archetype)
);

create table slot_claims (
  id text primary key,                         -- slc_
  opportunity_id text not null,
  archetype text not null,
  user_id text not null references users(id),
  project_id text not null references projects(id),
  state text not null check (state in ('OPEN','CLAIMED','RELEASED','EXPIRED')),
  claimed_at timestamptz not null default now(),
  deadline_at timestamptz not null,            -- claimed_at + stake_window_days（默认 7 天）
  released_at timestamptz,
  release_reason text check (release_reason in ('STAKE_EXPIRED','STAKE_INVALID','USER_ARCHIVED','OPPORTUNITY_ARCHIVED')),
  foreign key (opportunity_id, archetype) references opportunity_slots(opportunity_id, archetype)
);
-- opportunity_slots.claimed 是 slot_claims 的汇总缓存，两者由同一事务写入。
-- 计数据此而非 COUNT(*) 是为了让 GO 的并发抢占只需锁一行（见 10 §原子 GO）。
--
-- **活跃认领的唯一判定（D2）**：slot_claims.state = 'CLAIMED'。任何"某人是否还占着槽"
-- 的读路径都必须走这一列，不得改从 projects.status 推导——早期三处读路径分别用了
-- != 'ARCHIVED' 与 != 'ABANDONED'，后者不是合法取值，等于把归档项目也算作占用。
create unique index slot_claims_one_active_per_user_opportunity
  on slot_claims (user_id, opportunity_id) where state = 'CLAIMED';
create index slot_claims_deadline on slot_claims (deadline_at) where state = 'CLAIMED';

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
  -- 06 §4.2：行哈希按 hash_version 逐版本演进（1 = 11 字段，2 = +判定依据，
  -- 3 = +本列）。规格入哈希意味着"事后改判据"会在复算时暴露，而不只是靠约定。
  hash_version smallint not null default 1,
  prediction_spec jsonb,                       -- v3：判据版本 / 地平线 / 目标事件
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
  -- 取值以 12 §3 为唯一真源（VERDICT_CHANGE / WINDOW_CLOSING / SLOT_SCARCITY /
  -- PROJECT_RANK_JUMP / NEW_ENTRANT / KILL_CRITERIA / PULSE_CONFIRMED）。
  -- 库层 CHECK 是超集，应用层按"是否已实现求值路径"再收紧：未实现的类型必须拒绝创建，
  -- 否则规则会安静地躺在列表页里永远不响。
  rule_type text not null,
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
  domain text,                                 -- 核验通过后的主跟踪主机名；未核验时为 NULL
  launch_date date,
  target_keywords text[] not null default '{}',
  status text not null default 'IN_DEVELOPMENT'
    check (status in ('IN_DEVELOPMENT','LAUNCHED','ARCHIVED')),
  -- 承诺质押（PRD §1.7 第 5 条、F10）。7 天内未提交有效凭证即置 EXPIRED_RELEASED 并释放槽位；
  -- 已扣的月度导出配额**不退还**——这是让"占坑"有成本的那一半设计。
  stake_status text not null default 'PENDING'
    check (stake_status in ('PENDING','VERIFIED','EXPIRED_RELEASED')),
  stake_deadline_at timestamptz not null,      -- GO 时刻 + stake_window_days（默认 7 天）
  outcome_status text not null default 'UNKNOWN'
    check (outcome_status in ('UNKNOWN','NO_TRACTION','EARLY_TRACTION','TRACTION'))
);
create index projects_stake_deadline on projects (stake_deadline_at) where stake_status = 'PENDING';
-- 注意：status 的取值已统一为 IN_DEVELOPMENT/LAUNCHED/ARCHIVED（00 §4.3）。早期的
-- PLANNED/BUILDING/ABANDONED 与代码里的同义漂移一并作废——正是这套漂移让三处槽位计数
-- 分别用了 != 'ARCHIVED' 与 != 'ABANDONED'，从而算出不同的占用数。

-- 上线凭证（PRD F10 支持 3 类）。保留历史提交，便于回答"这个项目当时凭什么算上线"。
create table project_credentials (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  credential_type text not null
    check (credential_type in ('DOMAIN_URL','STORE_LISTING_URL','PUBLIC_PAGE_URL')),
  url text not null,
  host text,                                   -- 归一化主机名，供 SERP 快照内存匹配用
  verification_state text not null default 'PENDING'
    check (verification_state in ('PENDING','VERIFIED','REJECTED')),
  probe jsonb,                                 -- 探针提取的 <title>/<h1>/<meta> 与相关性判定
  checked_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);
create unique index project_credentials_one_verified
  on project_credentials (project_id) where verification_state = 'VERIFIED';

-- 无感 SERP 排名追踪的输出（PRD F10）。数据来自 F1 每周 Top 100 快照的内存匹配，
-- **不为追踪项目单独发起任何 SERP 请求**（一鱼多吃原则）。
create table project_serp_rankings (
  project_id text not null references projects(id) on delete cascade,
  query_id text not null references queries(id),
  obs_date date not null,
  best_rank integer,                           -- NULL 表示当日未进入 Top 100
  matched_url text,
  primary key (project_id, query_id, obs_date)
);

-- 处女地独占买断（ADR-018、PRD §1.7 第 5 条）。仅在 Σclaimed == 0 时可下单，
-- 部分唯一索引保证同一机会不会同时存在两个有效买断。
create table stealth_locks (
  id text primary key,                         -- slk_
  opportunity_id text not null references opportunities(id),
  user_id text not null references users(id),
  -- ACTIVE：生效中（已付款，或仍在待付窗口内）；EXPIRED：60 天保护期满，自动解密；
  -- VOID：待付窗口内未付款，占位作废。VOID 与 EXPIRED 必须分开：前者是"钱从没到"，
  -- 后者是"买了、期限到了"，把两者并成一档会让买断的成单率无法统计（00-INDEX §4.3）。
  status text not null check (status in ('ACTIVE','EXPIRED','VOID')),
  locked_at timestamptz not null default now(),
  -- locked_at + 60 天。**在待付窗口内就已确定**，而不是等付款后重算：投影要能在
  -- 下单那一刻就说出解密时刻，且付款落账不该让一个已公布的期限悄悄平移。
  unlock_at timestamptz not null,
  amount_usd numeric(10,2),
  -- 付款凭据。**它是"已付款"的唯一标记**——待付占位与已成交买断靠它区分，
  -- 而不是靠一个新状态值（那是同一事实的第二种表示，必然会漂）。
  provider_payment_id text,
  -- 托管结账会话。落库的理由是"同时至多一笔未付款占位"这条闸需要能**续付**：
  -- 用户丢了结账标签页时，第二次 POST 必须拿回同一个链接，而不是撞上部分唯一索引报错。
  provider_checkout_session_id text,
  provider_checkout_url text,
  checkout_expires_at timestamptz
);
create unique index stealth_locks_one_active
  on stealth_locks (opportunity_id) where status = 'ACTIVE';
-- 待付占位与 60 天期限共用 ACTIVE，二者的区别只在 provider_payment_id 是否为 NULL。
-- 因此"此刻是否被买断隐藏"的判据必须同时看两者与时间，见 §17 I13。
create index idx_stealth_locks_void_scan
  on stealth_locks (status, locked_at) where provider_payment_id is null;
create index idx_stealth_locks_expiry_scan
  on stealth_locks (status, unlock_at);
-- 买断期内的机会照常写入 verdicts 与 prediction_episodes 并计入 Cohort 胜率统计；
-- 只有**公开投影**打码为 [Stealth Locked #ID]（06 §7、15 §3）。账本与展示在此解耦，
-- 所以"封印"不会伤害战绩的可证伪性。

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

-- AI 建站点火包（ADR-019、PRD F8 交付物二、09 §5）。
-- 与报告的区别在于它绑定**一次具体的认领**而不是一次生成：同一机会可以放行 5 次
-- 原子立项，每人拿到的形态可能不同，因此点火包按 slot_claim 唯一，而不是按 (user, snapshot)。
create table launch_kits (
  id text primary key,                         -- lkit_
  report_id text not null references opportunity_reports(id),
  project_id text not null references projects(id) on delete cascade,
  slot_claim_id text not null references slot_claims(id),
  archetype text not null,                     -- 决定装配哪一套工程规范与页面骨架
  schema_version text not null default '1.0',
  files jsonb not null,                        -- CLAUDE.md / .cursorrules / pseo-routes.csv|json / landing.md
  content_hash char(64) not null,              -- 与 files 对应，用于复核与幂等
  generated_at timestamptz not null default now(),
  unique (slot_claim_id)
);
-- files 的硬数据（搜索动量、竞品价格、长尾词表）由确定性模板注入，LLM 只贡献 ≤ 500 字
-- 叙述（ADR-019、09 §5.3），所以 content_hash 可重算：同一快照 + 同一形态必得同一份点火包。
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
    check (page_type in ('OPPORTUNITY','MARKET','TREND_ENTITY','REPLAY','REPORT','COMPARE','TRACK_RECORD','CASE_STUDY')),
  slug text not null,
  locale text not null,
  opportunity_id text references opportunities(id),
  status text not null check (status in ('DRAFT','PUBLISHED','UNPUBLISHED')),
  indexable boolean not null default false,
  -- 资格判据快照。**不再含 45 天延迟**（PRD §7.1 已废除）：改为记录该页凭哪一条
  -- 准实时口径入选（`CROWDED_LOCKED` 或 `WINDOW_CLOSING`）以及当时的槽位状态，
  -- 使"为什么这条机会可以被免费用户看到"事后可复核（15 §3、20 §6）。
  eligibility jsonb not null,
  quality_report jsonb not null,
  canonical_url text,
  published_at timestamptz,
  unique (slug, locale)
);

-- Sealed Ledger（ADR-018、PRD §1.7 第 7 条）：买断期内公开投影的显示别名。
-- 单独成表而非改 public_pages，是因为**打码是展示层投影**，不是事实：期满必须能
-- 无损还原，而原页面本身从未被改写。
--
-- 它是**所有打码读路径的唯一标签来源**，而不是一张可以现算的冗余副本：公开战报
-- （06 §11）要输出 is_stealth_masked / masked_label / unmasked_at，若每个投影各自
-- 现算标签，第一处漂移就会变成一次 P0 泄露。一次 join 拿到同一份标签，是让"只打
-- 一次码"在结构上成立的最小做法。
create table stealth_lock_displays (
  stealth_lock_id text not null references stealth_locks(id),
  -- 冗余存 opportunity_id 只为读路径少一次 join，不作为主键的一部分。
  opportunity_id text not null references opportunities(id),
  masked_label text not null,                  -- 形如 [Stealth Locked #7f3a]
  locale text not null,
  unmasked_at timestamptz not null,            -- 与 stealth_locks.unlock_at 逐字一致（I14）
  -- 主键按**锁**而不是按机会：同一机会的第一笔买断 EXPIRED 之后，第二笔买断是合法
  -- 的（那时 Σclaimed 又回到 0，见 I13），而按 (opportunity_id, locale) 做主键时
  -- 第二笔会撞主键，唯一的出路是删掉第一笔的显示行——于是第一笔的锁就永远失去了
  -- 它"有且仅有一条显示行"的性质。键选错会把一个不变量的破坏伪装成一次主键冲突。
  primary key (stealth_lock_id, locale)
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
| I10 | 同一机会的 `Σ opportunity_slots.capacity ≤ max_capacity_total`（默认 6），且 `claimed ≤ capacity` | check 约束 + 创建槽位时的事务校验 |
| I11 | `slot_claims.state = 'CLAIMED'` 的行数与 `opportunity_slots.claimed` 一致；同一用户在同一机会至多一条 `CLAIMED` | `slot_claims_one_active_per_user_opportunity` 部分唯一索引 + 夜间一致性检查（防汇总缓存漂移） |
| I12 | 每个 `projects` 行的 `stake_status = 'PENDING'` 必须在 `stake_deadline_at` 前被终结（`VERIFIED` 或 `EXPIRED_RELEASED`） | 每日逾期待办任务（释放槽位）+ 监控：存在超期仍 `PENDING` 的行即告警 |
| I13 | 同一机会至多一个 `stealth_locks.status = 'ACTIVE'`，且下单时 `Σclaimed == 0`。**追加**：每条 `status='ACTIVE'` 的行必须满足 `provider_payment_id IS NOT NULL`（已成交）**或** `locked_at` 落在待付窗口内（待付窗口，默认 45 分钟；语义与常量归属见 10 §4.5b）。窗口一过，该行既不再隐藏机会、也不再算 ACTIVE，无论清理作业跑没跑 | `stealth_locks_one_active` 部分唯一索引（防多）+ 下单事务内校验（防非处女地）+ **判据自愈**：隐藏与否由 `status + unlock_at + provider_payment_id + locked_at` 现算，不依赖作业成败（多一道"只有作业跑过才算数"的门，就等于把正确性挂在调度器上） |
| I14 | 每条 `stealth_locks` 在**每个已发布的 locale** 各有且仅有一条 `stealth_lock_displays`，且 `unmasked_at` 与 `unlock_at` 逐字一致 | 下单事务内一并写入 + 夜间一致性检查 |
| I15 | `VOID` 行永不与 `provider_payment_id IS NOT NULL` 并存——钱到了就不可能作废 | 作废作业翻状态前先向供应商确认该会话未付款（一次查询，只对超窗口的行做）；webhook 落到 `VOID` 行即记 P0 告警（这是"钱已收、交付物不在"的唯一剩余入口，必须有人看到而不是静默 200） |

## 18. 保留与删除
- 用户删除账户：软删除 `users`；级联删除 `user_preferences`、`api_keys`、`notification_channels`、`opportunity_reports`、`gsc_connections`、令牌；`decisions` 与 `projects` 匿名化保留（去除 `user_id` 关联），因其构成校准数据；`audit_log` 中的 `actor_id` 替换为哈希。
- 账本与快照不含个人数据，永久保留。
- **反滥用标识的留存存在一处刻意的张力（需产品决策）**：`device_fingerprints` 与 `lifetime_scan_grants` 是"同一设备/IP 30 天 1 次"的判定依据，删除账户时若一并级联删除，注销再注册即可再领一次终身免费初筛；若保留，则等于在用户注销后继续保留其设备指纹。当前口径：**保留 `lifetime_scan_grants` 的哈希值（不含与人的关联），删除 `device_fingerprints`**，并在 §2 表中以 `on delete cascade` 标注。此口径须在隐私政策中明示（17 §3）。

> **实现与本节不一致（2026-10-12 核对，当日修正）**：
>
> 1. **注销走的不是 CASCADE**。账户删除是软删：`admin.service.ts` 把 `users.status` 置为 `DELETED` 并终止该用户全部会话；应用代码里**没有** `DELETE FROM users`（只有测试夹具在用）。所以 `ON DELETE CASCADE` 这条链在本节描述的注销场景里根本不会触发。
> 2. **因此「匿名化保留」只做到了「保留」**。行确实还在，但 `user_id` 仍指向那个已软删的账号 —— 既没有级联删除，也没有去除关联。`decisions.user_id` / `projects.user_id` 又都是 `NOT NULL`，`UPDATE ... SET user_id = NULL` 也无从落地；真要匿名化得先决定匿名成什么（占位账号？哈希？），本节没写。
> 3. `decisions` 上有一条只挡 UPDATE 的触发器（理由见 `schema.sql`），匿名化的 UPDATE 会被它拦下，需要开受控口子。
>
> 待办：把本节第 1 条按实际口径改写（列出真正软删/保留的表），并就第 2 条选定匿名化口径。第 1 条清单里除了 `decisions` / `projects` 之外的级联项，同样是本节写的、实现里没有的 —— 一并核对。
