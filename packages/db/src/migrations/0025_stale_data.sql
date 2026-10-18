-- 0025 — 72h STALE_DATA 降级所需的最后成功口径
--
-- `serp_snapshots` 只存了弱站比率，没有弱站分（0–100）。降级复用旧快照时若拿
-- 比率反推分数会与原始 W 轴不一致，所以把分数一并落库；老行保持 NULL，读取时
-- 才用比率近似。
ALTER TABLE serp_snapshots ADD COLUMN IF NOT EXISTS weakness_score NUMERIC(6,2);
