import { NextRequest, NextResponse } from 'next/server';
import { ReportService } from '@emeradar/services';
import { AppError } from '@emeradar/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locale = (searchParams.get('locale') || 'en-US') as any;

    // In production auth, extract user ID from session. For demo, use usr_demo_pro.
    const userId = request.headers.get('x-user-id') || 'usr_demo_pro';

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
