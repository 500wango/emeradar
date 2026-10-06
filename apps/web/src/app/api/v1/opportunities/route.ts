import { NextRequest, NextResponse } from 'next/server';
import { EntitlementService, OpportunityService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser, requireScope } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Authentication required to view opportunities.' },
        { status: 401 }
      );
    }
    const scopeError = requireScope(auth, 'opportunities:read');
    if (scopeError) return scopeError;
    const ent = await EntitlementService.getUserEntitlements(auth.user.id);
    const { searchParams } = new URL(request.url);
    const verdict = searchParams.get('verdict') as any;
    const archetype = searchParams.get('archetype') as any;
    const executionClass = searchParams.get('execution_class') as any;
    const minD = searchParams.get('min_d') ? parseInt(searchParams.get('min_d')!, 10) : undefined;
    const search = searchParams.get('search') || undefined;
    const limit = Math.min(50, Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20));
    const offset = Math.max(0, Number.parseInt(searchParams.get('offset') || '0', 10) || 0);

    const data = await OpportunityService.listFeedCards({
      verdict,
      archetype,
      executionClass,
      minD,
      search,
      limit,
      offset,
      minAgeDays: ent.feedDelayDays,
    });

    return NextResponse.json(data);
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500, detail: error.message },
      { status: 500 }
    );
  }
}
