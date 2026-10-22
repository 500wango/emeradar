-- 0047: 审计修复（2026-10-23）——任务价值 Gate 与查询级 SERP 满足度
--
-- 审计 01：OBSERVED 只说明「检索证据存在」。任务验证结论与依据单独落列，
-- 实验卡只认 TASK_VERIFIED（generate-experiment-cards 按 latest validation 过滤）。
-- 审计 02：「是工具页」≠「能解决这个搜索任务」。每条 SERP 结果同时记录
-- 查询级满足度，与 result_type（页面性质）相互独立。

ALTER TABLE discovery_validations ADD COLUMN IF NOT EXISTS task_status TEXT
  NOT NULL DEFAULT 'TASK_UNVERIFIED'
  CHECK (task_status IN ('TASK_VERIFIED', 'TASK_UNVERIFIED', 'TASK_REFUTED'));
ALTER TABLE discovery_validations ADD COLUMN IF NOT EXISTS task_evidence JSONB
  NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE serp_results ADD COLUMN IF NOT EXISTS query_relevance TEXT
  CHECK (query_relevance IN ('SATISFIES', 'NOT_SATISFIED', 'UNKNOWN'));
