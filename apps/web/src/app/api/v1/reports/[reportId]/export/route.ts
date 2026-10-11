import { NextRequest, NextResponse } from 'next/server';
import { ReportService } from '@emeradar/services';
import { getAuthUser, requireScope, requireVerifiedEmail } from '@/lib/auth-server';
import { AppError } from '@emeradar/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params;
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    // Exporting is a stronger right than reading: a key scoped to `reports:read`
    // must not be able to pull the file down.
    const scopeError = requireScope(auth, 'reports:export');
    if (scopeError) return scopeError;
    const verificationError = requireVerifiedEmail(auth);
    if (verificationError) return verificationError;
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
    console.error('[reports/export] Error:', error);
    return NextResponse.json(
      { type: 'about:blank', title: 'Export Error', status: 500, detail: 'The report could not be exported.' },
      { status: 500 }
    );
  }
}
