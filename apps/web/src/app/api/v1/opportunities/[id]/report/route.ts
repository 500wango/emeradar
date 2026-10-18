import { NextRequest, NextResponse } from 'next/server';
import { EntitlementService, ReportService, freeAccessibleOpportunityId } from '@emeradar/services';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope, requireVerifiedEmail } from '@/lib/auth-server';
import { AppError } from '@emeradar/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locale = (searchParams.get('locale') || 'en-US') as any;

    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'reports:read');
    if (scopeError) return scopeError;
    const verificationError = requireVerifiedEmail(auth);
    if (verificationError) return verificationError;
    const userId = auth.user.id;

    // 与详情/研报页同一道门禁：Free 只允许本周精选那一条。之前这里漏了判断，
    // 任何 Free 会话只要拿到一个活跃机会 id 就能生成它的完整报告。
    const ent = await EntitlementService.getUserEntitlements(userId);
    if (!ent.opportunityDetailFull) {
      const weeklyId = await freeAccessibleOpportunityId(id);
      if (!weeklyId) {
        return NextResponse.json(
          {
            type: 'about:blank',
            title: 'Plan Required',
            status: 403,
            detail: 'Full reports require a Builder Pro or Team plan.',
            upgradeUrl: '/pricing?feature=report',
          },
          { status: 403 },
        );
      }
    }

    const result = await ReportService.getOrGenerateReport(id, userId, locale);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return internalErrorResponse(error, 'opportunities/id/report');
  }
}
