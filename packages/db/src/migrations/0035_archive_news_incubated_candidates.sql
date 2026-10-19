-- 0035 — 清理新闻标题孵化出的候选
--
-- 旧 `incubateCandidatesFromDiscovery()` 把 HN/RSS 新闻标题直接写成机会
-- （candidate_reason = 'Captured from live signal [HACKER_NEWS_API]: ...'）。
-- 新闻标题不是搜索需求，主 query 也没有工具意图，只会污染候选池。
--
-- 只清理 CANDIDATE 且明确来自该旧逻辑的行；LIVE_SCAN 不碰。
UPDATE opportunities
   SET status = 'ARCHIVED', updated_at = NOW()
 WHERE status = 'CANDIDATE'
   AND candidate_reason LIKE 'Captured from live signal%';
