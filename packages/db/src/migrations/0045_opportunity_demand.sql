-- 0045 — 候选的入口需求信号（词量/难度/档位）
--
-- 这些**只用于入口筛选与展示**，绝不进评分：
-- D 轴若读供应商词量，会与 `external_demand_formed` 的事件判据自证（06 §7.1a）。
-- 单独存列而不是只写在 candidate_reason 里，是为了能按需求档位排序与统计。
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS entry_search_volume INTEGER,
  ADD COLUMN IF NOT EXISTS entry_keyword_difficulty INTEGER,
  ADD COLUMN IF NOT EXISTS volume_band TEXT CHECK (volume_band IN ('1K','5K','20K','100K+'));

COMMENT ON COLUMN opportunities.entry_search_volume IS
  '入口筛选时的第三方月搜索量估计；仅用于排序/展示，不参与任何评分';

CREATE INDEX IF NOT EXISTS idx_opportunities_volume_band
  ON opportunities(volume_band) WHERE volume_band IS NOT NULL;
