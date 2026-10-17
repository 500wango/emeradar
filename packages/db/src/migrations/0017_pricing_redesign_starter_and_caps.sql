-- 0016 — 定价重设计：新增 STARTER 套餐，调整 PRO/TEAM 权益与席位上限（定价分析 2026-10）。
--
-- 前向迁移，三件事：
--   1. plans 表新增 STARTER 行，权益配置为入门级（1 槽位、2 次立项/月、10 次初筛/月）。
--   2. PRO 权益调整：active_go_slots_max 2→3、live_scan_daily 30→20（改为月度配额）。
--   3. TEAM 权益调整：active_go_slots_max 2→10、atomic_go_export_monthly 5→15。
--
-- 注：原 entitlements 是扁平结构，无 features 嵌套；新 STARTER 沿用扁平结构。
-- 价格调整在 Stripe 侧配置，plans.price_usd_monthly 仅用于展示参考。

INSERT INTO plans (code, name, price_usd_monthly, entitlements)
VALUES (
  'STARTER',
  'Starter',
  49.00,
  '{
    "api_access": false,
    "max_alerts": 5,
    "max_projects": 3,
    "stealth_buyout": false,
    "feed_delay_days": 0,
    "live_scan_monthly": 10,
    "view_cards_monthly": -1,
    "active_go_slots_max": 1,
    "export_reports_monthly": 30,
    "atomic_go_export_monthly": 2,
    "generate_reports_monthly": 30,
    "pulse_radar": false,
    "max_watchlist": 50,
    "max_gsc_connections": 3,
    "history_window_days": 180
  }'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  price_usd_monthly = EXCLUDED.price_usd_monthly,
  entitlements = EXCLUDED.entitlements;

-- PRO 权益调整（3 槽位、20 次初筛/月、脉冲雷达开启）
UPDATE plans SET
  price_usd_monthly = 79.00,
  entitlements = entitlements
    || '{"active_go_slots_max": 3}'::jsonb
    || '{"live_scan_monthly": 20}'::jsonb
    || '{"pulse_radar": true}'::jsonb
    - 'live_scan_daily'
WHERE code = 'PRO';

-- TEAM 权益调整（10 槽位、15 次立项、50 次初筛/月）
UPDATE plans SET
  price_usd_monthly = 199.00,
  entitlements = entitlements
    || '{"active_go_slots_max": 10}'::jsonb
    || '{"atomic_go_export_monthly": 15}'::jsonb
    || '{"live_scan_monthly": 50}'::jsonb
    || '{"max_watchlist": 500}'::jsonb
    || '{"max_alerts": 50}'::jsonb
    - 'live_scan_daily'
WHERE code = 'TEAM';
