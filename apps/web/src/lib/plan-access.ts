/**
 * 套餐访问判据的**纯函数**，从路由与页面里抽出来，便于测试。
 *
 * 这些判断以前散落在 compare / detail / report 三处，各写各的，于是 report API
 * 漏掉 Free 门禁、compare 完全没有门禁。这里只做布尔决策，不碰数据库：调用方
 * 仍负责用 `freeAccessibleOpportunityId` 解析"Free 的周案例是哪一条"。
 */
export interface PlanAccess {
  opportunityDetailFull: boolean;
}

/** 比较页/API：需要完整详情权限（Free 至多一条可见机会，比较需要 2–3 条）。 */
export function canCompare(entitlements: PlanAccess): boolean {
  return entitlements.opportunityDetailFull;
}

/** 详情页/详情 API：付费层全部可见；Free 只有周案例那一条。 */
export function canOpenFullOpportunity(
  entitlements: PlanAccess,
  freeWeeklyId: string | null
): boolean {
  return entitlements.opportunityDetailFull || Boolean(freeWeeklyId);
}

/**
 * 报告入口/报告 API：
 * - 付费层只对已发布的 BUILD_NOW / EARLY_BET 生成（ReportService 的硬条件）；
 * - Free 只可能到周案例，而周案例按定义是历史案例——它是 13 §3.2 承诺的
 *   "每月 1 份历史案例预览"，因此允许（生成仍扣报告额度、导出仍被拦截）。
 */
export function canOpenReport(
  entitlements: PlanAccess,
  freeWeeklyId: string | null,
  verdict: string
): boolean {
  if (entitlements.opportunityDetailFull) {
    return verdict === 'BUILD_NOW' || verdict === 'EARLY_BET';
  }
  return Boolean(freeWeeklyId);
}
