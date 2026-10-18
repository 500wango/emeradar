import { NextRequest, NextResponse } from 'next/server';
import { EntitlementService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser } from '@/lib/auth-server';

/**
 * 原子立项的用量视图（13 §3.2、10 §4.3）。
 *
 * `GET /billing` 只回答"你买的是哪个套餐"，回答不了"这个月还能 GO 几次"。而 GO 的
 * 额度是**结转**的（Pro 3 次/月，未用完结转一期，余额上限 6），所以剩余量不能由前端
 * 拿套餐面额减本地计数算出来——那会把结转算丢。
 *
 * 返回 `{feature, period, limit, used, remaining, carryover_available}`：
 *   - `limit` 已含结转，是本期真正能用的次数；
 *   - `carryover_available` 单独给出，让界面能解释"为什么这个月有 6 次"；
 *   - Free 返回全 0（没有键就等于没有额度），不在这里抛 PLAN_REQUIRED——查看用量
 *     不是一次动作，用升级引导去拦它只会让人看不到自己缺什么。
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    }
    const usage = await EntitlementService.getAtomicGoUsage(auth.user.id);
    return NextResponse.json(usage);
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return internalErrorResponse(error, 'billing/usage');
  }
}
