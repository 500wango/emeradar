-- ============================================================================
-- 清理对象：后台 PROMOTE_TO_TRACKED 留下的脏卡
-- 成因（2026-10-06 修复前）：admin.service.ts 的 ON CONFLICT 分支只更新
--   verdict='BUILD_NOW'，不更新旧分数，导致卡片显示 BUILD_NOW 徽章 + D/M/W 0 分。
-- 修复后：CONFLICT 分支会同步补全评分字段，此脚本只需跑一次。
-- 用法：在生产库 psql 里先跑 Step 1 预览，确认行数后再跑 Step 2。
-- ============================================================================

-- Step 1: 预览将要修复的脏卡（只读）
SELECT opportunity_id, slug, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points,
       d_band, m_band, w_band, confidence
FROM opportunity_cards
WHERE verdict = 'BUILD_NOW'
  AND d_basis_points = 0
  AND m_basis_points = 0
  AND w_basis_points = 0;

-- Step 2: 修复 —— 与修复后的 promote 逻辑保持一致：
--   保留"管理员人工精选"的判定，用 admin-assertion 分数补齐零分字段。
--   （只影响 verdict='BUILD_NOW' 且三轴全零的卡，不碰有真实分数的卡）
-- UPDATE opportunity_cards
-- SET d_basis_points = 8000,
--     m_basis_points = 7500,
--     w_basis_points = 7800,
--     d_band = 'HIGH',
--     m_band = 'MEDIUM',
--     w_band = 'HIGH',
--     confidence = 'HIGH',
--     lifecycle = 'EARLY_WINDOW',
--     updated_at = NOW()
-- WHERE verdict = 'BUILD_NOW'
--   AND d_basis_points = 0
--   AND m_basis_points = 0
--   AND w_basis_points = 0;
