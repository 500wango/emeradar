-- 0010 — 告警规则类型放宽（31 T5.4；docs/12 §2 首发触发器）。
--
-- 纯前向迁移。先放宽 CHECK，应用层再决定哪些类型可订阅（EVALUATED_RULE_TYPES）。
-- 约束名沿用 PostgreSQL 对列内 CHECK 的默认命名。

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_rule_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_rule_type_check
  CHECK (rule_type IN (
    'VERDICT_CHANGE','WINDOW_CLOSING','NEW_ENTRANT','KILL_CRITERIA','SLOTS_LAST_ONE'
  ));
