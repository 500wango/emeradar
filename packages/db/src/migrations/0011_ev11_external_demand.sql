-- 0011 — ev-1.1 外部需求结果事件（31 T2.1；06 §7.1a）。
--
-- 纯前向迁移，三件事：
--   1. outcome_30d/60d/90d 增加 'UNEVALUABLE'：缺少外部数据源时如实记为「无法评估」，
--      不计入命中率分母，并单独报告比例（06 §7.1a）。它不是 MISS。
--   2. prevent_episode_rewrite() 把 UNEVALUABLE 同样当作终态：事后补进来的数据不能把
--      已经记为「无法评估」的地平线改判成 HIT/MISS，否则等于事后挑选口径。
--   3. external_demand_observations：ev-1.1 ①② 的原始序列（第三方词量、Trends 相对兴趣）。
--      这些数据必须从 Episode 开始那天起逐日写入，事后补采补不回预测日的值。

ALTER TABLE prediction_episodes DROP CONSTRAINT IF EXISTS prediction_episodes_outcome_30d_check;
ALTER TABLE prediction_episodes ADD CONSTRAINT prediction_episodes_outcome_30d_check
  CHECK (outcome_30d IN ('HIT','MISS','PENDING','UNEVALUABLE'));
ALTER TABLE prediction_episodes DROP CONSTRAINT IF EXISTS prediction_episodes_outcome_60d_check;
ALTER TABLE prediction_episodes ADD CONSTRAINT prediction_episodes_outcome_60d_check
  CHECK (outcome_60d IN ('HIT','MISS','PENDING','UNEVALUABLE'));
ALTER TABLE prediction_episodes DROP CONSTRAINT IF EXISTS prediction_episodes_outcome_90d_check;
ALTER TABLE prediction_episodes ADD CONSTRAINT prediction_episodes_outcome_90d_check
  CHECK (outcome_90d IN ('HIT','MISS','PENDING','UNEVALUABLE'));

CREATE OR REPLACE FUNCTION prevent_episode_rewrite()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.verdict_id IS DISTINCT FROM NEW.verdict_id
     OR OLD.opportunity_id IS DISTINCT FROM NEW.opportunity_id
     OR OLD.predicted_at IS DISTINCT FROM NEW.predicted_at
     OR OLD.published_verdict IS DISTINCT FROM NEW.published_verdict
     OR OLD.criteria_version IS DISTINCT FROM NEW.criteria_version
     OR OLD.criteria_snapshot IS DISTINCT FROM NEW.criteria_snapshot THEN
    RAISE EXCEPTION 'prediction_episodes: the prediction itself is immutable (id=%).', OLD.id
    USING ERRCODE = '0A000';
  END IF;

  IF (OLD.outcome_30d IN ('HIT','MISS','UNEVALUABLE') AND NEW.outcome_30d IS DISTINCT FROM OLD.outcome_30d)
     OR (OLD.outcome_60d IN ('HIT','MISS','UNEVALUABLE') AND NEW.outcome_60d IS DISTINCT FROM OLD.outcome_60d)
     OR (OLD.outcome_90d IN ('HIT','MISS','UNEVALUABLE') AND NEW.outcome_90d IS DISTINCT FROM OLD.outcome_90d) THEN
    RAISE EXCEPTION 'prediction_episodes: a graded outcome cannot be re-graded (id=%).', OLD.id
    USING ERRCODE = '0A000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS external_demand_observations (
  query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  obs_date DATE NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('src_volume','src_trends')),
  value NUMERIC NOT NULL CHECK (value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (query_id, source, obs_date)
);
