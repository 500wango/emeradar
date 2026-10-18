-- 0019 — v3.1 GO 契约的前置结构（阶段 B）
--
-- 阶段 B 的代码依赖三处**当前不存在**的结构：没有 credential_status，GO 的 Project
-- 插入写不进去；不先解绑 launch_kits.slot_claim_id，GO 不再调 SlotService.claim 之后
-- 点火包会因 NOT NULL 插入失败；PRO 的原子立项配额还是 0004 设定的 5。
--
-- 本迁移**只增不删**：槽位、质押、买断的列与表留到 0020（阶段 F）才拆，所以在
-- 0019 之后、C/D 完成之前，旧代码读旧列仍然可用。
--
-- 施工单 B0 之外另有两处**为新契约所必需**的调整，已在注释里标出（第 5、6 节）：
--   · stake_deadline_at 必须可空——B2 的 INSERT 不再写它，而 0003 把它设成了 NOT NULL；
--   · projects.decision_id 改为 NO ACTION——槽位认领不再是"落过项的决策不能删"的
--     物理依据（GO 不再建认领），这条既有不变量要换个依据，否则阶段 C 删掉
--     slot_claims 之后它会静默消失。

-- ---------------------------------------------------------------------------
-- 1. projects：凭证状态（v3.1 取代"质押状态"成为 GO 之后的可选核验状态）
-- ---------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS credential_status TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS credential_verified_at TIMESTAMPTZ;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_credential_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_credential_status_check
  CHECK (credential_status IN ('UNVERIFIED','PENDING','VERIFIED_OWNER','REJECTED'));

-- 存量回填：v3.0 里"质押已核验"就是 v3.1 的"凭证已核验"。
UPDATE projects
   SET credential_status = 'VERIFIED_OWNER',
       credential_verified_at = COALESCE(credential_verified_at, updated_at)
 WHERE stake_status = 'VERIFIED'
   AND credential_status = 'UNVERIFIED';

-- ---------------------------------------------------------------------------
-- 2. launch_kits：授权凭据从"认领"改为"该用户对该 decision_id 的 GO Project"
-- ---------------------------------------------------------------------------
ALTER TABLE launch_kits ADD COLUMN IF NOT EXISTS decision_id TEXT;

UPDATE launch_kits lk
   SET decision_id = p.decision_id
  FROM projects p
 WHERE p.id = lk.project_id
   AND lk.decision_id IS NULL
   AND p.decision_id IS NOT NULL;

-- 解绑 slot_claim_id：先解 FK 与 UNIQUE，再去 NOT NULL。列本身留到 0020 再删——
-- 0019 之后可能仍有按旧列写入的代码路径，现在删列会让它们直接失败。
ALTER TABLE launch_kits DROP CONSTRAINT IF EXISTS launch_kits_slot_claim_id_fkey;
ALTER TABLE launch_kits DROP CONSTRAINT IF EXISTS launch_kits_slot_claim_id_key;
ALTER TABLE launch_kits ALTER COLUMN slot_claim_id DROP NOT NULL;

-- 同一 decision_id 至多一份点火包：这就是"同一事务解锁"在存储侧的等价物。
CREATE UNIQUE INDEX IF NOT EXISTS idx_launch_kits_decision
  ON launch_kits(decision_id) WHERE decision_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. plans：PRO 原子立项 5 → 3（01 §1.8 第 5 条、13 §3.2）
-- ---------------------------------------------------------------------------
UPDATE plans
   SET entitlements = entitlements || '{"atomic_go_export_monthly": 3}'::jsonb
 WHERE code = 'PRO';

-- ---------------------------------------------------------------------------
-- 4. crowding_daily：拥挤透明度计数（只供展示、生命周期与 CROWDING_SIGNAL）
-- ---------------------------------------------------------------------------
ALTER TABLE crowding_daily ADD COLUMN IF NOT EXISTS verified_product_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crowding_daily ADD COLUMN IF NOT EXISTS top10_specialist_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crowding_daily ADD COLUMN IF NOT EXISTS new_top10_entrants_30d INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 5. projects.stake_deadline_at 允许为空（B2 的 INSERT 不再写它）
--
-- 0003 在回填后把它设成了 NOT NULL。v3.1 的 GO 不产生质押期限，也不再有"逾期释放"，
-- 所以新项目这一列就是 NULL；列本身留到 0020 才删。这里只放松约束，不删数据。
-- ---------------------------------------------------------------------------
ALTER TABLE projects ALTER COLUMN stake_deadline_at DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. projects.decision_id：落过项的决策不得删除（换个物理依据）
--
-- 旧依据是 slot_claims.project_id 的外键：删决策 → 级联删项目 → 被认领行挡住。
-- v3.1 的 GO 不再建认领，这条保护会随之消失，于是删一条 GO 决策就能静默带走用户
-- 的项目。改成 NO ACTION：语句结束时若仍有项目引用该决策则报 23503，而删用户时
-- 项目与决策都被级联删除，检查在同一语句末尾通过，不会反过来卡住注销路径。
-- ---------------------------------------------------------------------------
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_decision_id_fkey;
ALTER TABLE projects ADD CONSTRAINT projects_decision_id_fkey
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE NO ACTION;
