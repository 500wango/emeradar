-- 0033 — 区分“采集源故障”和“单个目标站点失败”
--
-- CRAWL_FETCH_ERROR: HTTP 404 是某个域名/页面不存在，不是 src_crawl 供应商挂了。
-- 旧熔断把它算进失败率，20 个目标里 18 个 404 就会误熔断并告警。
--
-- is_source_failure=false 的运行不计入熔断窗口；已有 404/robots/budget 运行回填为 false。
ALTER TABLE collector_runs
  ADD COLUMN IF NOT EXISTS is_source_failure BOOLEAN NOT NULL DEFAULT true;

UPDATE collector_runs
   SET is_source_failure = false
 WHERE source_id = 'src_crawl'
   AND status <> 'SUCCESS'
   AND (
     error_message ILIKE '%HTTP 404%'
     OR error_message ILIKE '%HTTP 410%'
     OR error_message ILIKE '%ROBOTS_DISALLOWED%'
     OR error_message ILIKE '%BUDGET_SKIPPED%'
   );

-- 误开的 crawl 熔断立即关闭；下一次失败会重新按新口径判定。
UPDATE source_circuit_breakers
   SET open_until = NULL, updated_at = NOW()
 WHERE source_id = 'src_crawl';
