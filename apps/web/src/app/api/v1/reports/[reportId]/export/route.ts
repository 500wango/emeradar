import { NextRequest, NextResponse } from 'next/server';
import { ReportService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser, hasScope, requireScope } from '@/lib/auth-server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params;
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    if (!hasScope(auth, 'reports:export') && !hasScope(auth, 'reports:read')) {
      return (
        requireScope(auth, 'reports:export') ??
        NextResponse.json({ error: 'Insufficient scope' }, { status: 403 })
      );
    }
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || 'markdown') as 'markdown' | 'json' | 'html';

    const exported = await ReportService.exportReportFormat(reportId, format, auth.user.id);

    return new NextResponse(exported.content, {
      status: 200,
      headers: {
        'Content-Type': exported.contentType,
        'Content-Disposition': `attachment; filename="${exported.filename}"`,
      },
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Export Error', status: 500, detail: error.message },
      { status: 500 }
    );
  }
}
