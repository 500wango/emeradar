-- 0006 — 无感 SERP 排名追踪（PRD F10、04 §9.2、02 §5）落地所需的三个缺口。
--
-- 0003 已经建好了 `project_serp_rankings`，但那条路径整条是**写不进东西**的：
--   a. 采集侧请求的是 `num=10`，取回的条目里根本不存在 rank 11–100，匹配无处可匹；
--   b. 快照表没有记录采集深度，事后无法区分"当日确实没进榜"与"当天只采了 10 条"；
--   c. 匹配的键 `project_credentials.host` 在 GO 路径上一直写 NULL。
--
-- 三件事互为前提：没有 (a) 就没有数据，没有 (c) 就没有键，没有 (b) 就没有办法解释
-- 一条 `best_rank IS NULL` 到底意味着什么。所以放在同一条迁移里。
--
-- 与 0001–0005 一样是前向迁移。

-- ---------------------------------------------------------------------------
-- 1. 采集深度与实际条数（03 §12 serp_snapshots）
-- ---------------------------------------------------------------------------
-- 两列缺一不可，因为它们回答的是不同的问题：
--   `depth`        —— 我们**要**多深。这是成本与能力的声明，一次请求换两种用途。
--   `result_count` —— 我们**拿到**多少。各家 provider 的上限不同（Brave / Tavily 20、
--                     SerpApi 100），低于 depth 是常态而不是故障。
--
-- 只有 `depth` 没有 `result_count`，就没法解释"某项目连续 60 天 best_rank IS NULL"
-- 是它真的没进榜，还是我们的采集深度掉到了 10。而这句话恰恰是 Gate 1 判据的一半。
-- 建列时的默认值刻意是 **10 而不是 100**：0006 之前的采集请求的就是 num=10
-- （serp-collector 的旧实现），所以存量行的深度就是 10。若默认 100，ALTER 会把这段
-- 历史一次性谎报成"当时也采了 100 条"，而那正是这一轮要修掉的那种沉默。
ALTER TABLE serp_snapshots ADD COLUMN IF NOT EXISTS depth SMALLINT NOT NULL DEFAULT 10;
ALTER TABLE serp_snapshots ADD COLUMN IF NOT EXISTS result_count SMALLINT NOT NULL DEFAULT 0;

-- 存量行的实际条数从 `serp_results` 数回来：那是当时唯一存下来的东西，所以它是
-- 当时拿到的条数的**下界**（1–10 全存，11 以上没存）。宁可记一个下限，也不填一个
-- 我们没有依据的数字。
UPDATE serp_snapshots s
   SET result_count = COALESCE(
         (SELECT COUNT(*) FROM serp_results r WHERE r.serp_snapshot_id = s.id), 0)
 WHERE s.result_count = 0;

-- 存量修完，默认值改回 100：此后的采集一律按一鱼多吃的深度发起。
ALTER TABLE serp_snapshots ALTER COLUMN depth SET DEFAULT 100;

-- ---------------------------------------------------------------------------
-- 2. 存量凭证的 host 回填
-- ---------------------------------------------------------------------------
-- `host` 是 SERP 匹配的键（02 §5）。GO 路径此前一直写 NULL，于是那批凭证永远不会被
-- 任何快照匹配到——追踪静默地什么也不做，而界面上看不出来。
--
-- 回填是**尽力而为**的 SQL 版本：取 scheme 之后、第一个 `/` 之前的段，去掉端口与
-- 前导 `www.`，转小写。它覆盖不了 IPv6 字面量这类边角（`[::1]:8080` 会被切坏），
-- 但那类 URL 本来就会被 `assertPublicHttpUrl` 挡在凭证之外，够不着这里。
-- 大小写必须先归一：`regexp_replace` 的 `^www\.` 是大小写敏感的，若先剥前缀再转小写，
-- 一个存成 `HTTPS://WWW.Example.com` 的旧 URL 会留下 `www.example.com`，与运行期
-- `normalizeCredentialHost` 给出的 `example.com` 不是同一个键。
-- 解析不出来的行保持 NULL：留着 NULL 只是"这个项目不被追踪"，填一个猜出来的主机名
-- 才会去匹配错误的域名。
UPDATE project_credentials
   SET host = NULLIF(
         regexp_replace(
           lower(split_part(split_part(split_part(url, '://', 2), '/', 1), ':', 1)),
           '^www\.', ''),
         '')
 WHERE host IS NULL
   AND url ~* '^https?://';

-- ---------------------------------------------------------------------------
-- 3. 读路径索引
-- ---------------------------------------------------------------------------
-- 排名曲线按 (项目, 时间) 取，主键是 (project_id, query_id, obs_date)，前缀能吃到
-- project_id 但排不了 obs_date 的全局序。曲线要的是"这个项目最近的 N 次观测"。
CREATE INDEX IF NOT EXISTS idx_project_serp_rankings_recent
  ON project_serp_rankings (project_id, obs_date DESC);
