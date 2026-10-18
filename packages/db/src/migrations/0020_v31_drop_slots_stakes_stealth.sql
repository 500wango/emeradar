-- 0020 — v3.1 收尾：拆除槽位、质押、买断与旧告警类型（阶段 F）
--
-- 执行前提（施工单 §9 F1）：阶段 C 的代码删除、阶段 D 的公开资格改写、阶段 E 的告警
-- 替换都已完成；代码侧对下列表/列的读取已为 0。本迁移在 `migrate.ts` 的**单事务**里
-- 执行，任何一步失败都会整体回滚。
--
-- 非本地环境执行前先做离线归档（文档口径：历史数据只作离线归档，不做数据搬迁）：
--
--   pg_dump --data-only --table=opportunity_slots --table=slot_claims \
--           --table=stealth_locks --table=stealth_lock_displays \
--           --table=stake_overdue_refunds "$DATABASE_URL" \
--     > emeradar_pre_v31_slots_stakes_stealth_$(date +%Y%m%d).sql
--
-- 本地测试库可跳过归档。

-- ---------------------------------------------------------------------------
-- 1. 买断（先子表后父表）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS stealth_lock_displays;
DROP TABLE IF EXISTS stealth_locks;

-- ---------------------------------------------------------------------------
-- 2. 槽位（先认领后容量；`slot_claims` 对 `opportunity_slots` 有复合外键）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS slot_claims;
DROP TABLE IF EXISTS opportunity_slots;

-- ---------------------------------------------------------------------------
-- 3. launch_kits：0019 已解绑并回填 `decision_id`，这一列可以删了
-- ---------------------------------------------------------------------------
ALTER TABLE launch_kits DROP COLUMN IF EXISTS slot_claim_id;

-- ---------------------------------------------------------------------------
-- 4. crowding_daily：只留透明度计数，槽位汇总与 crowding_index 一并删除
--    （W 已不再消费它们，见 05 §3.3）
-- ---------------------------------------------------------------------------
ALTER TABLE crowding_daily DROP COLUMN IF EXISTS slots_claimed_total;
ALTER TABLE crowding_daily DROP COLUMN IF EXISTS slots_capacity_total;
ALTER TABLE crowding_daily DROP COLUMN IF EXISTS crowding_index;

-- ---------------------------------------------------------------------------
-- 5. projects：质押列、部分索引、GO 配额周期起点
--
--    `outcome_status` **保留**（它是战绩评估的输入，与质押无关）。
--    `go_quota_period_start` 没有任何读取方：配额账在 `usage_counters`
--    （按 user + feature + period 分行），项目行上再存一份只会是第二个真源。
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS projects_stake_deadline;
ALTER TABLE projects DROP COLUMN IF EXISTS stake_status;
ALTER TABLE projects DROP COLUMN IF EXISTS stake_deadline_at;
ALTER TABLE projects DROP COLUMN IF EXISTS go_quota_period_start;

-- ---------------------------------------------------------------------------
-- 6. 逾期退款台账（随质押机制一起删除）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS stake_overdue_refunds;

-- ---------------------------------------------------------------------------
-- 7. plans.entitlements：前向清理 + 按 13 §3.2 补齐首发票据
--
--    仓库里的 entitlements 仍是**扁平**结构（0004 的注释解释过为什么不先剥信封），
--    所以这里补的也是扁平键。`feed_selected_weekly` 用 1/0 表达"每周 1 条 / 不适用"
--    —— 代码只判真值；带 period/limit 的对象信封属于 13 §3.2 的目标态，不在本轮。
-- ---------------------------------------------------------------------------
UPDATE plans
   SET entitlements = entitlements - 'active_go_slots_max' - 'stealth_buyout' - 'feed_delay_days'
 WHERE code IN ('FREE','PRO','STARTER','TEAM');

UPDATE plans
   SET entitlements = entitlements
     || '{"feed_realtime": false, "feed_selected_weekly": 1}'::jsonb
 WHERE code = 'FREE';

UPDATE plans
   SET entitlements = entitlements
     || '{"feed_realtime": true, "feed_selected_weekly": 0}'::jsonb
 WHERE code IN ('PRO','STARTER','TEAM');

-- `launch_kit_export` 不再作为权益键：原子 GO 扣过配额后，点火包就是已购交付物，
-- 降级后拦截它等于撤销已成交的交付；Free 又没有 GO 路径，这个键没有可执行的拒绝点。

-- 20 §6：PRO 的项目上限 10 → 50
UPDATE plans
   SET entitlements = entitlements || '{"max_projects": 50}'::jsonb
 WHERE code = 'PRO';

-- ---------------------------------------------------------------------------
-- 8. alert_rules.rule_type：先停用存量旧类型行，再重建 CHECK
--
--    旧 CHECK 里有已删除的槽位触发器与 Phase 2 的 NEW_ENTRANT。**停用不够**：
--    新 CHECK 会校验所有存量行，`is_active = false` 并不会让旧取值通过校验。
--    这些规则已经没有任何求值路径，直接删除（`alert_events.alert_rule_id` 是
--    ON DELETE CASCADE，事件随规则一起清掉），否则 0020 会在有历史行的库上整体回滚。
--    新集合取 12 §2 的首发 6 条。注意：应用层目前只写其中四条——
--    `PROJECT_SERP_RANK_JUMP` 只在 ranking.service 有纯检测函数、
--    `CUSTOM_QUERY_PULSE_CONFIRMED` 尚未实现；CHECK 是目录的上界，
--    可订阅集合仍由 `EVALUATED_RULE_TYPES` 决定。
-- ---------------------------------------------------------------------------
DELETE FROM alert_rules WHERE rule_type IN ('SLOTS_LAST_ONE','NEW_ENTRANT');

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_rule_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_rule_type_check
  CHECK (rule_type IN (
    'VERDICT_CHANGE',
    'WINDOW_CLOSING',
    'CROWDING_SIGNAL',
    'KILL_CRITERIA',
    'PROJECT_SERP_RANK_JUMP',
    'CUSTOM_QUERY_PULSE_CONFIRMED'
  ));

-- ---------------------------------------------------------------------------
-- 9. subscriptions：补 purchase_kind 与 billing_interval
--
--    - `billing_interval`：季度 Builder Pass 不是独立 plan_code，而是 PRO 权益在
--      QUARTER 下的售卖方式（03 §3、13 §3.1）。存量一律按规格默认 MONTH 回填。
--    - `purchase_kind`：一次性 Founding Lifetime 不产生续费事件（13 §4.4）。
--      存量里没有订阅号、只有 PaymentIntent 的行就是那类一次性付款，据此回填。
-- ---------------------------------------------------------------------------
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'MONTH';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS purchase_kind TEXT NOT NULL DEFAULT 'SUBSCRIPTION';

-- 存量行的计费周期没有可靠来源：`stripe_purchases` 不存 cycle，`stripe_checkout_intents`
-- 有 cycle 却没有 subscription_id，二者无法安全关联。因此 `billing_interval` 只能按规格
-- 默认 MONTH（年付历史行会显示成 MONTH，写侧从这里之后由 activateSubscription 维护）；
-- `purchase_kind` 则可以用"只有 PaymentIntent、没有订阅号"这一可靠特征回填。

UPDATE subscriptions
   SET purchase_kind = 'FOUNDING_LIFETIME'
 WHERE stripe_payment_intent_id IS NOT NULL
   AND stripe_subscription_id IS NULL;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_interval_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_billing_interval_check
  CHECK (billing_interval IN ('MONTH','QUARTER','YEAR'));

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_purchase_kind_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_purchase_kind_check
  CHECK (purchase_kind IN ('SUBSCRIPTION','FOUNDING_LIFETIME'));

-- ---------------------------------------------------------------------------
-- 10. public_pages：清理 v3.0 的旧资格凭据
--
--     - 买断打码页（slug 形如 `stealth-lock-<lockId>`）没有作者了，直接删除：
--       它们指向的表已经在第 1 步拆掉，留着只会让一条"保护期页面"继续 200。
--     - 以 `CROWDED_LOCKED` / `STEALTH_LOCKED` 为准入理由的页在 v3.1 下不再成立，
--       翻回 `DRAFT` 并留下可复核的遗留标记；下一轮 S8 会按新判据重算资格，
--       仍然"已失去抢跑价值"的会自然恢复 `PUBLISHED`。
--     - 不做 JSONB CHECK：凭据形状包含蚕食/质量两块嵌套对象，现在加约束只会把
--       未来的一次字段扩展变成一次迁移失败。
-- ---------------------------------------------------------------------------
DELETE FROM public_pages WHERE slug LIKE 'stealth-lock-%';

UPDATE public_pages
   SET status = 'DRAFT',
       eligibility = jsonb_build_object(
         'reason', 'LEGACY_PRE_V31',
         'legacyBasis', COALESCE(eligibility -> 'admission' ->> 'basis', eligibility ->> 'reason'),
         'cleanedAt', NOW()
       )
 WHERE eligibility -> 'admission' ->> 'basis' IN ('CROWDED_LOCKED','STEALTH_LOCKED')
    OR eligibility ->> 'reason' IN ('CROWDED_LOCKED','STEALTH_LOCKED');
