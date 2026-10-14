-- 0003 — PRD v2.1 的定价前提：按形态切分的认领槽位、承诺质押、配额结转。
--
-- 这一版落地 01 §1.7 第 5 条与 03 §8/§12 的数据模型。三件事必须一起做，因为它们
-- 是同一个机制的三面：
--   1. 槽位（opportunity_slots / slot_claims）—— "点 GO 占一个坑"从此是物理事实，
--      不再是按 projects 行数推导出来的估算值；
--   2. 质押（projects.stake_*）—— 占坑有 7 天期限，逾期释放，让"占坑"有成本；
--   3. 结转（usage_carryovers）—— 月度原子立项配额跨月累计，使"这个月没用完"可被
--      逐笔回答，而不是靠一个会漂移的余额数字。
--
-- 与 0001/0002 一样是前向迁移：不修改任何既有列的定义，除非该定义本身是错的
-- （见下面 archetype 一段）。

-- ---------------------------------------------------------------------------
-- 1. 构建形态拼写收敛：LIGHTWEIGHT_TOOL -> TOOL
-- ---------------------------------------------------------------------------
-- LIGHTWEIGHT_TOOL 曾经是 BuildArchetype 的**一个独立成员**，与 TOOL 并存，于是
-- 同一个形态在库里分裂成两个字符串。后果不是报错，而是静默失效：所有按 archetype
-- 取键的查询（槽位容量、点火包模板）会分成互不相交的两套，Σcapacity ≤ 6 形同虚设，
-- 表现为"槽位明明没满却熔断了"。规范取值见 00-INDEX §4.3。
--
-- 先归一化存量行，再加 CHECK —— 顺序不能反，否则约束会直接拒绝这次迁移。
UPDATE opportunities      SET recommended_archetype = 'TOOL' WHERE recommended_archetype = 'LIGHTWEIGHT_TOOL';
UPDATE opportunity_cards  SET recommended_archetype = 'TOOL' WHERE recommended_archetype = 'LIGHTWEIGHT_TOOL';
UPDATE projects           SET build_type            = 'TOOL' WHERE build_type            = 'LIGHTWEIGHT_TOOL';
UPDATE user_preferences
   SET preferred_build_types = array_replace(preferred_build_types, 'LIGHTWEIGHT_TOOL', 'TOOL')
 WHERE 'LIGHTWEIGHT_TOOL' = ANY (preferred_build_types);

ALTER TABLE opportunities     ALTER COLUMN recommended_archetype SET DEFAULT 'TOOL';
ALTER TABLE projects          ALTER COLUMN build_type            SET DEFAULT 'TOOL';

-- CHECK 是这次收敛真正的价值所在：它让"同一个形态两种拼写"不可能再次发生。
-- 若某个库里还残留未知取值，这几条会直接让整个迁移回滚并指名道姓——这是有意的，
-- 静默通过才是原缺陷的成因。Phase 2 新增 API_DEVTOOL / MANAGED_SERVICE 时，
-- 按 00-INDEX §8 的顺序先改索引与 05，再发一条新迁移放宽这里。
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_recommended_archetype_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_recommended_archetype_check
  CHECK (recommended_archetype IN ('TOOL','CONTENT_SITE','PSEO_SITE','DIRECTORY','MICRO_SAAS'));

ALTER TABLE opportunity_cards DROP CONSTRAINT IF EXISTS opportunity_cards_recommended_archetype_check;
ALTER TABLE opportunity_cards ADD CONSTRAINT opportunity_cards_recommended_archetype_check
  CHECK (recommended_archetype IN ('TOOL','CONTENT_SITE','PSEO_SITE','DIRECTORY','MICRO_SAAS'));

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_build_type_check;
ALTER TABLE projects ADD CONSTRAINT projects_build_type_check
  CHECK (build_type IN ('TOOL','CONTENT_SITE','PSEO_SITE','DIRECTORY','MICRO_SAAS'));

-- ---------------------------------------------------------------------------
-- 2. 认领槽位（ADR-018、01 §1.7 第 5 条、05 §5.1）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunity_slots (
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  archetype TEXT NOT NULL CHECK (archetype IN ('TOOL','CONTENT_SITE','PSEO_SITE','DIRECTORY','MICRO_SAAS')),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  claimed INTEGER NOT NULL DEFAULT 0 CHECK (claimed >= 0 AND claimed <= capacity),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (opportunity_id, archetype)
);

-- 按 Build Archetype 切分是"一条机会可以有多条队"的原因：不同形态的认领者互不挤占，
-- 避免所有订阅者做出同一个同质竞品。
CREATE TABLE IF NOT EXISTS slot_claims (
  id TEXT PRIMARY KEY,                         -- slc_
  opportunity_id TEXT NOT NULL,
  archetype TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  state TEXT NOT NULL CHECK (state IN ('OPEN','CLAIMED','RELEASED','EXPIRED')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deadline_at TIMESTAMPTZ NOT NULL,            -- claimed_at + stake_window_days（默认 7 天）
  released_at TIMESTAMPTZ,
  release_reason TEXT CHECK (release_reason IN ('STAKE_EXPIRED','STAKE_INVALID','USER_ARCHIVED','OPPORTUNITY_ARCHIVED')),
  FOREIGN KEY (opportunity_id, archetype) REFERENCES opportunity_slots(opportunity_id, archetype)
);

-- **活跃认领的唯一判定（D2）**：slot_claims.state = 'CLAIMED'。任何"某人是否还占着槽"
-- 的读路径都必须走这一列，不得再从 projects.status 推导——早期三处读路径分别用了
-- != 'ARCHIVED' 与 != 'ABANDONED'，后者根本不是合法取值，等于把归档项目也算作占用。
--
-- opportunity_slots.claimed 是 slot_claims 的汇总缓存，由同一事务写入。计数走缓存
-- 而非 COUNT(*) 是为了让 GO 的并发抢占只需锁一行（10 §原子 GO）。缓存与真值的漂移
-- 由不变量 I11 的夜间一致性检查兜底。
CREATE UNIQUE INDEX IF NOT EXISTS slot_claims_one_active_per_user_opportunity
  ON slot_claims (user_id, opportunity_id) WHERE state = 'CLAIMED';
CREATE INDEX IF NOT EXISTS slot_claims_deadline
  ON slot_claims (deadline_at) WHERE state = 'CLAIMED';

-- 拥挤度按**当前占用**落库，取代"14 天内点过 GO 的人数"。区别在质押上：7 天逾期会
-- 释放槽位，而"点过 GO"的计数会把已释放的人永久算作占用。
CREATE TABLE IF NOT EXISTS crowding_daily (
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  obs_date DATE NOT NULL,
  slots_claimed_total INTEGER NOT NULL,        -- Σ 全部形态中 state = 'CLAIMED' 的数量
  slots_capacity_total INTEGER NOT NULL,       -- Σ 全部形态的 capacity（≤ max_capacity_total）
  crowding_index NUMERIC(5,2) NOT NULL,
  PRIMARY KEY (opportunity_id, obs_date)
);

-- ---------------------------------------------------------------------------
-- 3. 承诺质押与上线凭证（PRD F10、01 §1.7 第 5 条）
-- ---------------------------------------------------------------------------
-- 7 天内未提交有效凭证即置 EXPIRED_RELEASED 并释放槽位；已扣的月度导出配额**不退还**
-- —— 这是让"占坑"有成本的那一半设计。
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stake_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stake_deadline_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS outcome_status TEXT NOT NULL DEFAULT 'UNKNOWN';

-- 存量行补一个期限再上 NOT NULL：列在 03 §12 里是无默认值的 not null，但直接 ADD
-- COLUMN NOT NULL 会在任何有行的库上失败。实验型项目同样适用——"7 天内证明你真的
-- 动手了"对实验和正式项目是同一件事。
UPDATE projects SET stake_deadline_at = created_at + INTERVAL '7 days' WHERE stake_deadline_at IS NULL;
ALTER TABLE projects ALTER COLUMN stake_deadline_at SET NOT NULL;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_stake_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_stake_status_check
  CHECK (stake_status IN ('PENDING','VERIFIED','EXPIRED_RELEASED'));

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_outcome_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_outcome_status_check
  CHECK (outcome_status IN ('UNKNOWN','NO_TRACTION','EARLY_TRACTION','TRACTION'));

-- 逾期待办（不变量 I12）每天扫这张部分索引。存在超期仍 PENDING 的行即告警。
CREATE INDEX IF NOT EXISTS projects_stake_deadline
  ON projects (stake_deadline_at) WHERE stake_status = 'PENDING';

-- 上线凭证保留历史提交，便于事后回答"这个项目当时凭什么算上线"。三类凭证见
-- 00-INDEX §4.3 的 credential_type。
CREATE TABLE IF NOT EXISTS project_credentials (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL
    CHECK (credential_type IN ('DOMAIN_URL','STORE_LISTING_URL','PUBLIC_PAGE_URL')),
  url TEXT NOT NULL,
  host TEXT,                                   -- 归一化主机名，供 SERP 快照内存匹配用
  verification_state TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (verification_state IN ('PENDING','VERIFIED','REJECTED')),
  probe JSONB,                                 -- 探针提取的 <title>/<h1>/<meta> 与相关性判定
  checked_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_credentials_one_verified
  ON project_credentials (project_id) WHERE verification_state = 'VERIFIED';

-- 无感 SERP 排名追踪的输出。数据来自每周 Top 100 快照的内存匹配，**不为追踪中的
-- 项目单独发起任何 SERP 请求**（一鱼多吃原则，04 §4.4）。
CREATE TABLE IF NOT EXISTS project_serp_rankings (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query_id TEXT NOT NULL REFERENCES queries(id),
  obs_date DATE NOT NULL,
  best_rank INTEGER,                           -- NULL 表示当日未进入 Top 100
  matched_url TEXT,
  PRIMARY KEY (project_id, query_id, obs_date)
);

-- ---------------------------------------------------------------------------
-- 4. 配额结转（PRD §8.1、13 §4.1）
-- ---------------------------------------------------------------------------
-- 跨月累计不改 usage_counters 的结构：周期结束时的剩余额度写进这张表，下一周期读取
-- 时叠加。每次结转留一行，"未用完的额度去哪了"因此可被逐笔回答。
-- 只对配置了 rollover: true 的 feature 生效（首发仅 Pro 的原子立项导出）。
CREATE TABLE IF NOT EXISTS usage_carryovers (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  from_period_start DATE NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0),
  carried_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_in_period DATE,                     -- 已被哪个周期消费；NULL 表示仍可叠加
  PRIMARY KEY (user_id, feature, from_period_start)
);
