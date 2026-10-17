-- 0015 — 封存完整评分输入（31 T2.6；05 §8 recompute 的前提）。
--
-- 账本只存 features_hash（特征的指纹），不存特征本身，所以无法重算。scoring_input 存的是
-- 当日喂给 calculateOpportunityScore 的**完整输入**；recompute 读它重新调用同一个纯函数。
-- 一旦写入不可改写：重算比对的是「当时的输入」，输入若能被改，比对就没有意义。
-- 存量快照为 NULL，不回填（回填等于替它们声称一份从未记录过的输入）。

ALTER TABLE opportunity_snapshots ADD COLUMN IF NOT EXISTS scoring_input JSONB;

CREATE OR REPLACE FUNCTION prevent_snapshot_input_rewrite()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.scoring_input IS NOT NULL AND NEW.scoring_input IS DISTINCT FROM OLD.scoring_input THEN
    RAISE EXCEPTION 'opportunity_snapshots.scoring_input is sealed once written (id=%).', OLD.id
    USING ERRCODE = '0A000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_input_sealed ON opportunity_snapshots;
CREATE TRIGGER trg_snapshot_input_sealed
BEFORE UPDATE ON opportunity_snapshots
FOR EACH ROW
EXECUTE FUNCTION prevent_snapshot_input_rewrite();
