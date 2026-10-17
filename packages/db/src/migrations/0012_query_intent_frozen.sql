-- 0012 — query 意图入库冻结（31 T3.2；ADR-020：重算不得依赖会变的分类器）。
--
-- 纯前向迁移。intent 一旦写入就不可改：报告、点火包重算读的是这一列，所以同一个词
-- 在任何时候重算都得到同一个意图。存量行为 NULL，由读路径首次使用时补写一次。

ALTER TABLE queries ADD COLUMN IF NOT EXISTS intent TEXT
  CHECK (intent IN ('INFORMATIONAL','COMMERCIAL','TRANSACTIONAL','NAVIGATIONAL'));

CREATE OR REPLACE FUNCTION prevent_query_intent_rewrite()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.intent IS NOT NULL AND NEW.intent IS DISTINCT FROM OLD.intent THEN
    RAISE EXCEPTION 'queries.intent is frozen once written (id=%).', OLD.id
    USING ERRCODE = '0A000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_queries_intent_frozen ON queries;
CREATE TRIGGER trg_queries_intent_frozen
BEFORE UPDATE ON queries
FOR EACH ROW
EXECUTE FUNCTION prevent_query_intent_rewrite();
