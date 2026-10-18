-- 0030 — 一次性清理语义漂移的种子候选
--
-- `keyword_suggestions` 会返回“语义相关但不是工具需求”的词；旧过滤把
-- `2026 hell`、`ai valuation` 一类短语写进了 CANDIDATE，占满 150 的候选池。
-- 新的入口过滤（packages/services/src/pipeline/seed-keyword-candidates.ts）已经
-- 阻止后续写入；这里清理已经进库的历史噪音。
--
-- 只动 discovery_source='KEYWORD_SEED'；用户主动扫描的 LIVE_SCAN 不碰。
-- 保留任何带工具/软件名词的词（例如 "ai valuation calculator"）。
UPDATE opportunities
   SET status = 'ARCHIVED', updated_at = NOW()
 WHERE status = 'CANDIDATE'
   AND discovery_source = 'KEYWORD_SEED'
   AND title ~* '\y(hell|valuation|funding|market size|salary|jobs?|course|tutorial|news|forecast|report|trend)\y'
   AND title !~* '\y(generator|calculator|converter|template|checker|maker|estimator|planner|tracker|alternative|extension|api|plugin|integration|dashboard|monitor|scheduler|scraper|extractor|summarizer|workflow|compliance|checklist|directory|tool|tools|software|app|apps|platform|automation|builder|editor|manager|assistant|crm|erp|saas|website|landing page|portfolio)\y';
