-- 0031 — 清理旧的 autocomplete 扩展候选
--
-- 这些不是 KEYWORD_SEED，而是已删除的 `discoverAutocompleteCandidates()` 旧逻辑留下的
-- "New related search: ..." 候选（例如 2026 hell's kitchen winner）。当前 pipeline 只把
-- 联想词挂进同一个机会的 CLUSTER，不再创建新机会；所以这批历史行可以安全归档。
--
-- 只动 discovery_source='AUTOCOMPLETE' 且 candidate_reason 明确为旧逻辑文案的 CANDIDATE；
-- LIVE_SCAN / KEYWORD_SEED 不碰。
UPDATE opportunities
   SET status = 'ARCHIVED', updated_at = NOW()
 WHERE status = 'CANDIDATE'
   AND discovery_source = 'AUTOCOMPLETE'
   AND candidate_reason LIKE 'New related search:%';
