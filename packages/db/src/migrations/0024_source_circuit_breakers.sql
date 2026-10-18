-- 0024 — 采集熔断状态（04 §4：5 分钟窗口、失败率 >50% 打开 15 分钟）
--
-- worker 是多进程/多实例的，内存计数无法跨进程；状态必须落库。
CREATE TABLE IF NOT EXISTS source_circuit_breakers (
  source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  open_until TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collector_runs_source_started
  ON collector_runs(source_id, started_at DESC);
