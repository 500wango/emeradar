-- 0005 的“旧世界”里，`projects.stake_deadline_at` 仍是 NOT NULL（0003 设的）。
-- v3.1 拆掉了质押，0019 才放松这一列；这份夹具只是需要一个“0006 之前的项目行”，
-- 不应该反过来依赖一个后来被拆除的约束。DDL 放在 .sql 里，免得测试代码里出现
-- 列名——阶段 C 之后代码侧不再有任何对它的引用。
ALTER TABLE projects ALTER COLUMN stake_deadline_at DROP NOT NULL;
