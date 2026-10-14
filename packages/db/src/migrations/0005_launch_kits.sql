-- 0005 — 形态点火包（Launch Kit）的存储。
--
-- 03 §13 早就在数据模型里规定了 `launch_kits`，但直到 ADR-018 的原子 GO 落地它才有
-- 可写入的时机：点火包**只能**由一次成功的 GO 解锁，不存在"先拿点火包再决定要不要
-- GO"的路径。所以这条迁移排在 0004（原子 GO 落地）之后。
--
-- 为什么要把产物整份存下来，而不是每次导出重新装配：
--   09 §5.3 硬约束 1 要求同一 `(opportunity_id, snapshot_id, archetype,
--   template_version)` 必得 bit-for-bit 相同的点火包。而装配输入里有一段 **LLM 撰写的
--   叙述**（ADR-019：≤ 500 字），它不可能被确定性地重算。所以叙述在首次装配时一次性
--   写入 `files` 并就此冻结，此后导出只读这份冻结值——与 PRD P5/P7 对快照标签的要求
--   同源：**重算路径严禁再调用 LLM**。
--
-- 与 0001-0004 一样是前向迁移。

-- ---------------------------------------------------------------------------
-- 1. 点火包
-- ---------------------------------------------------------------------------
-- 列定义与 03 §13 一致，只补一个 03 那里没写、但导出端点必须回答的问题：
-- 这份产物是**按哪个模板版本**装配的。响应头要把 snapshot / template /
-- scoring_config 三项一并交出去（10 §4.4），让用户自己核对同一份输入是否得到同一份
-- 交付物；模板版本藏在一个常量里而不落库，事后就再也无法回答"这一份是谁装配的"。
CREATE TABLE IF NOT EXISTS launch_kits (
  id TEXT PRIMARY KEY,                                        -- lkit_
  report_id TEXT NOT NULL REFERENCES opportunity_reports(id),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 与 slot_claims 一对一：点火包绑定的是**一次具体的认领**，不是一次生成。同一机会
  -- 可以放行 5 次原子立项、每人形态可能不同，所以唯一键在认领上，不在 (user, snapshot)。
  slot_claim_id TEXT NOT NULL REFERENCES slot_claims(id),
  archetype TEXT NOT NULL,                                    -- 决定装配了哪一套模板
  schema_version TEXT NOT NULL DEFAULT '1.0',
  template_version TEXT NOT NULL,
  snapshot_id TEXT REFERENCES opportunity_snapshots(id),
  scoring_config_version TEXT NOT NULL,
  research_language TEXT NOT NULL,
  files JSONB NOT NULL,                                       -- 三件套的逐文件内容
  -- 装配的**输入**之一，必须单独存：叙述由 LLM 撰写且不可确定性重算，而复核
  -- （"用同一份输入重装一遍看指纹对不对"）需要把同一段叙述喂回去。从渲染好的
  -- 文件里再抠出叙述是做不了的——那是字符串手术，模板一改就失效，而失效的方式
  -- 是"复核悄悄永远是 false"。
  narrative JSONB,
  content_hash CHAR(64) NOT NULL,                             -- 与 files 对应，可重算
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slot_claim_id)
);

-- 导出走 Project，所以按 project 查是最常走的那条路径。
CREATE INDEX IF NOT EXISTS idx_launch_kits_project ON launch_kits(project_id);
-- content_hash 是复核（"重算是否仍得到同一份"）的入口，值得单独可查。
CREATE INDEX IF NOT EXISTS idx_launch_kits_hash ON launch_kits(content_hash);

-- ---------------------------------------------------------------------------
-- 2. 存量 GO 项目补一份点火包
-- ---------------------------------------------------------------------------
-- 0004 之前立项的项目没有认领记录，也就没有可绑定的 slot_claim，因此**补不出**
-- 点火包——而这是对的：它们的 GO 发生在"点火包"这个概念存在之前，那时并没有解锁
-- 过任何东西。这里不做回填，只留一条注释说明为什么不。

-- ---------------------------------------------------------------------------
-- 3. 结构校验：形态取值必须与 00-INDEX §4.3 一致
-- ---------------------------------------------------------------------------
-- 与 0003 对 archetype 的处理同一个理由：CHECK 让"同一个形态两种拼写"不可能再发生。
-- 存量若残留未知取值，这条会直接让迁移回滚并指名道姓——静默通过才是原缺陷的成因。
ALTER TABLE launch_kits DROP CONSTRAINT IF EXISTS launch_kits_archetype_check;
ALTER TABLE launch_kits ADD CONSTRAINT launch_kits_archetype_check
  CHECK (archetype IN ('TOOL','CONTENT_SITE','PSEO_SITE','DIRECTORY','MICRO_SAAS'));
