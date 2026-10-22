/**
 * Stamped into every ledger row this scorer writes (05 §7.2). Existing rows keep their
 * own stored version, so a bump is forward-only. Bump when rules change output for the same input.
 *
 * sc-1.4.0（2026-10-23 审计修复）：SERP 加总应用 pageDiscount（审计 05）；
 * 需求轴引入持久新词口径与 30 天增长基线（审计 04）；商业覆盖不足时 HIGH 封顶
 * MEDIUM 并标 PENDING（审计 06）。同输入不同输出，必须换版本。
 */
export const SCORING_CONFIG_VERSION = 'sc-1.4.0';
