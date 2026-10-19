-- 0039 — 回填已有机会的词法指纹
--
-- 0038 之后只有新候选会写指纹；存量候选需要在首轮 canonical 归并前补上，
-- 否则同一个需求会“新旧各一份”，归并看起来没生效。
--
-- SQL 必须与 `canonical-query.service.lexicalFingerprint` 完全一致：
-- 小写 → 非字母数字转空格 → 单复数归一（长度>3 且以 s 结尾）→ convert 归一
-- → 去停用词 → token 排序。
WITH normalized AS (
  SELECT o.id,
         q.query_text AS surface
    FROM opportunities o
    LEFT JOIN opportunity_queries oq ON oq.opportunity_id = o.id AND oq.role = 'PRIMARY'
    LEFT JOIN queries q ON q.id = oq.query_id
   WHERE o.lexical_fingerprint IS NULL
), tokens AS (
  SELECT id,
         (
           SELECT string_agg(t, ' ' ORDER BY t)
             FROM (
               SELECT CASE
                        WHEN w IN ('convert', 'conversion', 'converter') THEN 'convert'
                        WHEN length(w) > 3 AND right(w, 1) = 's' THEN left(w, length(w) - 1)
                        ELSE w
                      END AS t
                 FROM unnest(regexp_split_to_array(lower(COALESCE(surface, '')), '[^a-z0-9]+')) AS w
                WHERE w <> ''
                  AND w NOT IN ('a', 'an', 'the', 'for', 'to', 'of', 'in', 'on', 'file', 'free', 'online', 'best', 'top')
             ) s
         ) AS fingerprint
    FROM normalized
)
UPDATE opportunities o
   SET lexical_fingerprint = t.fingerprint
  FROM tokens t
 WHERE o.id = t.id AND COALESCE(t.fingerprint, '') <> '';
