import { NextRequest, NextResponse } from 'next/server';
import { EntitlementService, OpportunityService, freeAccessibleOpportunityId } from '@emeradar/services';
import { getAuthUser, requireScope } from '@/lib/auth-server';
import { AppError } from '@emeradar/core';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthUser(_request);
    if (!auth) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Authentication required to view opportunities.' },
        { status: 401 }
      );
    }
    const scopeError = requireScope(auth, 'opportunities:read');
    if (scopeError) return scopeError;
    const ent = await EntitlementService.getUserEntitlements(auth.user.id);
    const { id } = await params;
    // Free 只能读本周精选那一条（13 §3.2），与 Feed 同源判据。
    const weeklyId = ent.opportunityDetailFull ? null : await freeAccessibleOpportunityId(id);
    if (!ent.opportunityDetailFull && !weeklyId) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Plan Required', status: 403, detail: 'Full opportunity details require a Builder Pro or Team plan.', upgradeUrl: '/pricing' },
        { status: 403 }
      );
    }
    // Free 的详情访问只有一条路：本周精选（上面已判过），不再套任何天数延迟。
    const data = await OpportunityService.getOpportunityDetail(id);
    return NextResponse.json(data);
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    console.error('[opportunities/detail] Error:', error);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'The opportunity could not be loaded.' },
      { status: 500 }
    );
  }
}
