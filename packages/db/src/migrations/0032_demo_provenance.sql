-- 0032 — demo 数据打标，并从公开面移除
--
-- `seed-radar-opportunities.ts` 会写入编造的 autocomplete/SERP/商业证据；演示机会
-- 以 TRACKED 状态进了首页，读起来像真实 BUILD NOW。从本迁移起：
--   - opportunities.is_demo = true 标记演示来源；
--   - 归档这些机会（不再作为可发布机会）；
--   - 撤回对应 public_pages。
--
-- 公开查询（Feed / 首页 / 周案例 / 详情 / 发布）也会显式排除 is_demo。
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- 种子主机会
UPDATE opportunities
   SET is_demo = true
 WHERE discovery_source = 'RADAR_DISCOVERY';

-- 旧 discoverAutocompleteCandidates 从种子联想词派生出的机会
UPDATE opportunities
   SET is_demo = true
 WHERE discovery_source = 'AUTOCOMPLETE'
   AND candidate_reason LIKE 'New related search:%';

UPDATE opportunities
   SET status = 'ARCHIVED', updated_at = NOW()
 WHERE is_demo = true AND status <> 'ARCHIVED';

UPDATE public_pages
   SET status = 'DRAFT', indexable = false
 WHERE opportunity_id IN (SELECT id FROM opportunities WHERE is_demo = true);
