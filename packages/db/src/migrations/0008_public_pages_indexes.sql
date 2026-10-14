-- 0008 — `public_pages` 的读写索引（15 §3 的准实时精选准入）。
--
-- 纯新增、不改数据、不改约束。这张表从 0001 起就只有主键与 `UNIQUE (slug, locale)`，
-- 而它的三条**每日**路径全都在全表扫：
--
--   1. 蚕食防护（15 §3 第 3 条）要拿"当前会被 Google 收录的机会页"当参照，按
--      `(page_type, locale) WHERE status='PUBLISHED' AND indexable=true` 筛。这条查询
--      每轮 S8 跑一次，返回的全是那小撮已发布且可收录的页。
--   2. `clearMaskedProjection` 按 `opportunity_id` 删打码页，**每次非打码发布都会跑
--      一次**（即每个被追踪机会每天一次），没有索引就是每天几百次全表扫。
--   3. `publishMasked` 的 `UPDATE ... WHERE opportunity_id = $1 AND slug = $2 AND locale = $3`
--      同受益于 `opportunity_id` 上的索引。
--
-- 两个索引都只建索引、不触碰行。第 2、3 条查的是 `opportunity_id`，用**非部分**索引：
-- 该列可空（TRACK_RECORD / METHODOLOGY 页的 `opportunity_id` 是 NULL），而部分索引的
-- 谓词能否被 `opportunity_id = $1` 蕴含取决于规划器的谓词推导——为省一点体积去赌这个
-- 推导不划算，这张表本来也不大。
--
-- 与 0001–0007 一样是前向迁移。

-- 按机会找页：打码页的删除、打码投影的更新。
CREATE INDEX IF NOT EXISTS idx_public_pages_opportunity
  ON public_pages (opportunity_id);

-- 蚕食防护的参照集合。部分索引是刻意的：绝大多数行是 DRAFT（每条被追踪机会每天都会
-- 被 upsert 一次，而绝大多数机会并不满足准入），真正会被收录的只是很小一撮。
CREATE INDEX IF NOT EXISTS idx_public_pages_published_indexable
  ON public_pages (page_type, locale)
  WHERE status = 'PUBLISHED' AND indexable = true;
