-- 0034 — 清理信息性定义类种子候选
--
-- “CSV 文件定义 / CSV 文件含义 / 定义 CSV 文件”这类词是定义查询，不是工具需求；
-- 旧过滤只看“包含种子 + 词数”，让它们进了 CANDIDATE。
--
-- 只清理 discovery_source='KEYWORD_SEED' 且明确信息性/定义性的 CANDIDATE；
-- 带工具名词（converter/generator/api/...）的保留。
UPDATE opportunities o
   SET status = 'ARCHIVED', updated_at = NOW()
 WHERE o.status = 'CANDIDATE'
   AND o.discovery_source = 'KEYWORD_SEED'
   AND (
     o.candidate_reason ILIKE '%intent informational%'
     OR o.candidate_reason LIKE '%信息性%'
     OR o.title ~* '\y(definition|meaning|what is|what are|explained|examples?)\y'
     OR o.title ~ '(定义|含义|意思|是什么|解释)'
   )
   AND o.title !~* '\y(generator|calculator|converter|convert|template|checker|maker|estimator|planner|tracker|tool|software|app|platform|automation|dashboard|monitor|scheduler|scraper|extractor|summarizer|workflow|compliance|plugin|integration|api|crm|erp|saas|merge|split|compress|generate|validate)\y';
