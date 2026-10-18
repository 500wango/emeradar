import { NextRequest, NextResponse } from 'next/server';
import { AppError, compareSchema, parseInput } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { EntitlementService, OpportunityService } from '@emeradar/services';
import { getAuthUser, requireScope } from '@/lib/auth-server';
import { canCompare } from '@/lib/plan-access';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });

    const scopeError = requireScope(auth, 'opportunities:read');
    if (scopeError) return scopeError;

    const entitlements = await EntitlementService.getUserEntitlements(auth.user.id);
    if (auth.authMethod === 'api_key' && !entitlements.apiAccess) {
      return NextResponse.json(
        { type: 'about:blank', title: 'API access unavailable', status: 403, detail: 'API access is not available for this plan.' },
        { status: 403 },
      );
    }

    // 比较固定展示多条**活跃**机会的标题、查询、三轴与止损计数的并排对比。
    // Free 只可见周案例（13 §3.2：Free 至多一条，比较需要 2–3 条），所以这里与
    // 详情页共用同一道门禁，而不是只靠"Free 拿不到 2 个 id"。
    if (!canCompare(entitlements)) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Plan Required',
          status: 403,
          detail: 'Comparison requires a Builder Pro or Team plan.',
          upgradeUrl: '/pricing?feature=compare',
        },
        { status: 403 },
      );
    }

    const { ids } = parseInput(compareSchema, await request.json().catch(() => ({})));
    const items = await OpportunityService.compareOpportunities(ids);
    return NextResponse.json({ items });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'opportunities/compare');
  }
}
