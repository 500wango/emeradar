-- 0027 — 逐域/逐源记录 STALE_DATA 的来源，而不只打一个总标志
--
-- 之前只把 `STALE_DATA` 写进 verdict flags，无法回答"具体哪个域名沿用了哪条旧证据"。
-- 这张表记录每次降级实际使用的快照/证据引用，供审计与 Admin 查看。
CREATE TABLE IF NOT EXISTS stale_data_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obs_date DATE NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('AUTOCOMPLETE','SERP','COMMERCIAL')),
  domain TEXT NOT NULL DEFAULT '',
  reference_id TEXT,
  observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (obs_date, opportunity_id, source, domain)
);

CREATE INDEX IF NOT EXISTS idx_stale_data_events_opp_date
  ON stale_data_events(opportunity_id, obs_date DESC);
