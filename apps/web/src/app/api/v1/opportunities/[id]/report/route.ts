import { NextRequest, NextResponse } from 'next/server';
import { ReportService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser, requireScope } from '@/lib/auth-server';

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
    const userId = auth.user.id;

    const result = await ReportService.getOrGenerateReport(id, userId, locale);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Report Generation Error', status: 500, detail: error.message },
      { status: 500 }
    );
  }
}
