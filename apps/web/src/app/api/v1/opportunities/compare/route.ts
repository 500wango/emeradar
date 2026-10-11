import { NextRequest, NextResponse } from 'next/server';
import { AppError } from '@emeradar/core';
import { EntitlementService, OpportunityService } from '@emeradar/services';
import { getAuthUser, requireScope } from '@/lib/auth-server';

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

    const body = await request.json().catch(() => null);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string') : [];
    const items = await OpportunityService.compareOpportunities(ids, { minAgeDays: entitlements.feedDelayDays });
    return NextResponse.json({ items });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return NextResponse.json({ type: 'about:blank', title: 'Error', status: 500, detail: error.message }, { status: 500 });
  }
}
