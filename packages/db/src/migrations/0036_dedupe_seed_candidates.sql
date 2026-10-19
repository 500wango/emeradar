-- 0036 — 去重已入库的种子候选，并清理购买词噪音
--
-- 旧 dedupeKey 没有去停用词/合并 conversion，导致：
--   template spreadsheet / template for spreadsheet
--   csv to excel conversion / convert a csv file to excel
-- 各占一条候选并重复观测。这里按同一规范化键只保留最早一条。
WITH tokenized AS (
  SELECT o.id,
         o.created_at,
         (
           SELECT array_to_string(array_agg(t ORDER BY t), ' ')
             FROM (
               SELECT CASE
                        WHEN w IN ('convert', 'conversion', 'converter') THEN 'convert'
                        ELSE w
                      END AS t
                 FROM unnest(regexp_split_to_array(lower(o.title), '[^a-z0-9]+')) AS w
                WHERE w <> ''
                  AND w NOT IN ('a', 'an', 'the', 'for', 'to', 'of', 'in', 'on', 'file', 'free', 'online', 'best', 'top')
             ) s
         ) AS dedupe_key
    FROM opportunities o
   WHERE o.status = 'CANDIDATE'
     AND o.discovery_source = 'KEYWORD_SEED'
), ranked AS (
  SELECT id, row_number() OVER (PARTITION BY dedupe_key ORDER BY created_at ASC, id) AS rn
    FROM tokenized
)
UPDATE opportunities o
   SET status = 'ARCHIVED', updated_at = NOW()
  FROM ranked r
 WHERE o.id = r.id AND r.rn > 1;

-- 没有工具/交付物名词的购买词：ac buy spreadsheet 之类。
UPDATE opportunities
   SET status = 'ARCHIVED', updated_at = NOW()
 WHERE status = 'CANDIDATE'
   AND discovery_source = 'KEYWORD_SEED'
   AND title ~* '\y(buy|purchase|order)\y'
   AND title !~* '\y(generator|calculator|converter|convert|template|checker|maker|estimator|planner|tracker|tool|software|app|platform|automation|dashboard|monitor|scheduler|scraper|extractor|summarizer|workflow|compliance|plugin|integration|api|crm|erp|saas|merge|split|compress|generate|validate)\y';
