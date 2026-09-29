import { NextRequest, NextResponse } from 'next/server';
import { EntitlementService, OpportunityService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser } from '@/lib/auth-server';

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
    const ent = await EntitlementService.getUserEntitlements(auth.user.id);
    if (!ent.opportunityDetailFull) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Plan Required', status: 403, detail: 'Full opportunity details require a Builder Pro or Team plan.', upgradeUrl: '/pricing' },
        { status: 403 }
      );
    }
    const { id } = await params;
    const data = await OpportunityService.getOpportunityDetail(id);
    return NextResponse.json(data);
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Error', status: 500, detail: error.message },
      { status: 500 }
    );
  }
}
