-- 0026 — Autocomplete/Crawl 也挂原始载荷
--
-- SERP 已有 `serp_snapshots.raw_payload_id`；AC 与商业抓取此前只存归一化结果，
-- 出了争议无法回放原始响应。R2 归档后把 id 挂到各自的快照行。
ALTER TABLE autocomplete_observations
  ADD COLUMN IF NOT EXISTS raw_payload_id UUID REFERENCES raw_payloads(id) ON DELETE SET NULL;

ALTER TABLE commercial_snapshots
  ADD COLUMN IF NOT EXISTS raw_payload_id UUID REFERENCES raw_payloads(id) ON DELETE SET NULL;
