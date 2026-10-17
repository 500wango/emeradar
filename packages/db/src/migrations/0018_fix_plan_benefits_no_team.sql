-- 修正套餐权益配置（面向独立开发者，移除 TEAM 层）
--
-- 1. FREE 层移除告警和项目追踪（PRD §8.1：免费层不支持自动化追踪与告警）
-- 2. PRO 项目上限从 50 降至 10（独立开发者 3 槽位 + 7 个历史项目观察）
-- 3. 隐藏 TEAM 套餐（PRD §2.1 明确：不服务小型 Growth 团队）

-- FREE 层移除自动化功能
UPDATE plans SET
  entitlements = entitlements
    || '{"max_alerts": 0}'::jsonb
    || '{"max_projects": 0}'::jsonb
WHERE code = 'FREE';

-- PRO 项目上限降至 10（对标竞品 Ahrefs/SEMrush 5 项目，给予 2× 缓冲）
UPDATE plans SET
  entitlements = entitlements || '{"max_projects": 10}'::jsonb
WHERE code = 'PRO';

-- 隐藏 TEAM 套餐（暂不删除数据，以防有遗留订阅）
UPDATE plans SET
  is_active = false
WHERE code = 'TEAM';
