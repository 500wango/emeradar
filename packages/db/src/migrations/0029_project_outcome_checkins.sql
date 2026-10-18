-- 0029 — 项目结果回访（T+30/60/90）
--
-- 发现是否有效，最终要看用户做出来之后发生了什么。projects.outcome_status 只有
-- 当前值，没有历史；这里保留每次回访，供项目页与公开战绩分组使用。
CREATE TABLE IF NOT EXISTS project_outcome_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN
    ('BUILDING','LAUNCHED','ABANDONED','NO_TRACTION','EARLY_TRACTION','TRACTION')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_outcome_checkins_project
  ON project_outcome_checkins(project_id, created_at DESC);
