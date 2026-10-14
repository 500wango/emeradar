import { NextRequest, NextResponse } from 'next/server';
import { ReportService } from '@emeradar/services';
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

    // `viewerId` 不只是记账：买断保护期内它对非持有者会 404（10 §7），与详情同口径。
    const result = await ReportService.getOrGenerateReport(id, userId, locale, {
      viewerId: userId,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return internalErrorResponse(error, 'opportunities/id/report');
  }
}
