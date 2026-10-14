-- 0004 — 原子 GO 的配额键，以及把存量项目折算成认领。
--
-- 0003 建好了槽位与质押的表结构，但没有回答两个问题：
--   1. 一次原子立项该扣哪个配额？答案必须是**独立的**一个键，不能复用报告导出——
--      否则"锁槽一次"和"导出一次"会分叉成两个可分别绕过的闸门（13 §4.3）。
--   2. 0003 之前就存在的项目算什么？它们占着机会，但 `slot_claims` 里没有对应的行，
--      于是 `opportunity_slots.claimed` 会从 0 开始，等于把存量占用一次性清空。
--
-- 与 0001-0003 一样是前向迁移。

-- ---------------------------------------------------------------------------
-- 1. 原子立项配额（13 §3.2、13 §4.3、10 §4.3）
-- ---------------------------------------------------------------------------
-- 键名沿用 13 §3.2 的 `atomic_go_export_monthly` 与 `active_go_slots_max`。
--
-- 目前 `plans.entitlements` 是**扁平**的，而 13 §3.2 描述的最终形态是
-- `{plan_code, features: {...}}` 信封。这一版**不**改信封：剥掉信封的同时必须处理
-- `feed_delay_days` 的废除，而免费层的实时体验要改由 `feed_selected_weekly` 承担
-- （13 §3.2、15 §3）。在 `feed_selected_weekly` 落地之前撤掉 `feed_delay_days`，
-- 免费用户会直接拿到实时 Feed——那是"空槽窗口泄露"，15 §8 定为 P0 事故。
-- 信封属于 Epic 1.6（19 §4），届时键名不变，只是挪进 `features`。
--
-- 只加不删：FREE 显式写 0，避免读侧靠 `?? ` 兜底去猜免费层有没有 GO 权限。
UPDATE plans
   SET entitlements = entitlements
     || CASE code
          WHEN 'FREE' THEN '{"active_go_slots_max": 0}'::jsonb
          WHEN 'PRO'  THEN '{"atomic_go_export_monthly": 5, "active_go_slots_max": 2}'::jsonb
          -- TEAM 是历史兼容值（13 §3.1），不在结账页出现。沿用旧目录里它一贯高于
          -- PRO 的口径，避免一个已存在的 TEAM 订阅因为这次迁移被削额。
          WHEN 'TEAM' THEN '{"atomic_go_export_monthly": 100, "active_go_slots_max": 2}'::jsonb
          ELSE '{}'::jsonb
        END
 WHERE code IN ('FREE','PRO','TEAM');

-- 0001 的目录修复块用 `entitlements->>'max_projects'` 判别三个历史坏字面量。扁平键
-- 还在，所以那段不受影响；这里记一笔是为了让将来改信封的人知道那里也要跟着改。

-- ---------------------------------------------------------------------------
-- 2. 槽位行：一条机会提供哪几个形态的队
-- ---------------------------------------------------------------------------
-- 这个集合在**首次物化时冻结**，此后不随每日评分变化。若允许按当日 top-3 增删，
-- 累计的 Σcapacity 迟早越过 `max_capacity_total`（I10），而删行会把已认领的槽位
-- 连同认领记录一起弄丢。
--
-- 回填只能拿到 `recommended_archetype`——推荐层的前三名没有落库，补不出历史就不
-- 假装补得出。0004 之后新发布的机会由 observe 路径按 `topArchetypes` 建满三形态。
INSERT INTO opportunity_slots (opportunity_id, archetype, capacity)
SELECT o.id, a.archetype, 2
FROM opportunities o
JOIN LATERAL (
  SELECT o.recommended_archetype AS archetype
  UNION
  -- 仍持有认领的存量项目所用形态也要有槽位行，否则下面的 slot_claims 外键无处可指。
  SELECT p.build_type FROM projects p
   WHERE p.opportunity_id = o.id
     AND p.status <> 'ARCHIVED'
     AND p.created_at >= NOW() - INTERVAL '7 days'
) a ON true
WHERE o.status = 'TRACKED'
ON CONFLICT (opportunity_id, archetype) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. 存量项目的质押归属
-- ---------------------------------------------------------------------------
-- 质押机制在 0004 之前不存在，所以存量项目分两类，判据是"它的 7 天窗口还没走完"：
--
--   - 窗口未走完的（7 天内建的）：按新规则的正常状态处理，PENDING，并折算成一条
--     CLAIMED 认领，`stake_deadline_at` 已由 0003 置为 created_at + 7 天。
--   - 窗口早已走完的：**质押从未成立**。置 EXPIRED_RELEASED 而不是 VERIFIED——
--     后者等于替用户宣称他证明了自己上线，而他从没被要求过，也没提交过任何东西。
--     EXPIRED_RELEASED 在三个取值里是唯一诚实的那个：没有活跃质押。这些项目本身
--     继续存在、继续被追踪，只是不占槽位——槽位是由质押维持的。
UPDATE projects
   SET stake_status = 'EXPIRED_RELEASED'
 WHERE stake_status = 'PENDING'
   AND created_at < NOW() - INTERVAL '7 days';

-- 一个用户在同一条机会上可能有多个未归档项目（旧规则允许，上限 5）。D2 只承认一条
-- 活跃认领（`slot_claims_one_active_per_user_opportunity`），所以每个 (用户, 机会)
-- 只折算最早的那个项目；其余项目仍然存在，只是不进槽位账。
CREATE TEMP TABLE legacy_claims ON COMMIT DROP AS
SELECT DISTINCT ON (p.user_id, p.opportunity_id)
       p.id AS project_id, p.opportunity_id, p.build_type AS archetype,
       p.user_id, p.created_at, p.stake_deadline_at
  FROM projects p
 WHERE p.opportunity_id IS NOT NULL
   AND p.status <> 'ARCHIVED'
   AND p.stake_status = 'PENDING'
 ORDER BY p.user_id, p.opportunity_id, p.created_at ASC;

-- 容量先抬到存量占用之上再插认领：旧上限是"每机会 5"，可能超过每形态 2。抬容量
-- 而不是丢认领，因为丢认领等于把已存在的占用从账上抹掉。
UPDATE opportunity_slots s
   SET capacity = GREATEST(s.capacity, c.n)
  FROM (SELECT opportunity_id, archetype, COUNT(*)::int AS n
          FROM legacy_claims GROUP BY opportunity_id, archetype) c
 WHERE s.opportunity_id = c.opportunity_id AND s.archetype = c.archetype;

INSERT INTO slot_claims (id, opportunity_id, archetype, user_id, project_id, state, claimed_at, deadline_at)
SELECT 'slc_legacy_' || l.project_id, l.opportunity_id, l.archetype, l.user_id,
       l.project_id, 'CLAIMED', l.created_at, l.stake_deadline_at
  FROM legacy_claims l
ON CONFLICT (id) DO NOTHING;

-- 汇总缓存与认领同源。I11 的夜间检查从这里开始才有一致的基线可比。
UPDATE opportunity_slots s
   SET claimed = (SELECT COUNT(*)::int FROM slot_claims sc
                   WHERE sc.opportunity_id = s.opportunity_id
                     AND sc.archetype = s.archetype
                     AND sc.state = 'CLAIMED'),
       updated_at = NOW();
