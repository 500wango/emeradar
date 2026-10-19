-- 0042 — Phase 4：分层轮询 + 内容寻址去重（CAS）
--
-- 所有词每天全量抓一遍，成本会随候选池线性爆炸。分层轮询打破这个模式，但必须
-- **记录抽样原因**：回测时要能区分“那天本来就不抓”和“那天抓失败了”。
ALTER TABLE serp_snapshots
  ADD COLUMN IF NOT EXISTS sampling_reason TEXT;

COMMENT ON COLUMN serp_snapshots.sampling_reason IS
  'BASELINE_DAILY / WEEKLY / EVENT_AUTOCOMPLETE_JUMP / BACKFILL；NULL 表示历史行未记录';

-- 商业快照记内容哈希：DOM 没变就不重新解析，也不重复写派生数据。
ALTER TABLE commercial_snapshots
  ADD COLUMN IF NOT EXISTS content_hash CHAR(64);

-- 原始载荷的内容寻址：同一份内容只上传一次，其余行复用 storage_url。
CREATE INDEX IF NOT EXISTS idx_raw_payloads_hash_source
  ON raw_payloads(content_hash, source_id);

-- 派生数据与原始数据分开存：清洗后的 DOM 子树是为了热查询，
-- **不能替代原始字节**——解析规则一改，被清洗掉的部分可能正是下一版需要的。
CREATE TABLE IF NOT EXISTS raw_payload_derivatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_payload_id UUID NOT NULL REFERENCES raw_payloads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  derivative_version TEXT NOT NULL,
  storage_url TEXT,
  byte_size INTEGER,
  content_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raw_payload_id, kind, derivative_version)
);

CREATE INDEX IF NOT EXISTS idx_raw_derivatives_payload
  ON raw_payload_derivatives(raw_payload_id);
