-- 0044 — SERP 结果记录页面种类与分类器版本
--
-- 分类结果直接进 W 轴。只有把「这一行是按哪一版规则分类的」写下来，
-- 历史才能按版本分组重算，阈值回测也才知道自己在比什么。
ALTER TABLE serp_results
  ADD COLUMN IF NOT EXISTS page_kind TEXT,
  ADD COLUMN IF NOT EXISTS classifier_version TEXT;

CREATE INDEX IF NOT EXISTS idx_serp_results_classifier
  ON serp_results(classifier_version);
