-- 0013 — 官方 Demo 词（31 T5.6；10 §4.3b，R15）。
--
-- 固定 3 条、由 Admin 维护、详情只读**预先冻结**的快照：匿名接口不得触发任何实时采集，
-- 否则就成了免费初筛。snapshot 为空表示还没冻结，接口回 503 DEMO_UNAVAILABLE。

CREATE TABLE IF NOT EXISTS screener_demos (
  demo_id TEXT PRIMARY KEY CHECK (demo_id ~ '^demo_[a-z0-9_]+$'),
  query TEXT NOT NULL,
  market_country TEXT NOT NULL DEFAULT 'US',
  research_language TEXT NOT NULL DEFAULT 'en-US',
  snapshot JSONB,
  snapshot_date DATE,
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (position)
);
