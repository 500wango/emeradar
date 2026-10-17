import { NextRequest, NextResponse } from 'next/server';
import { ScreenerDemoService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';

// 只读冻结快照：零配额、零外部请求；快照缺失回 503 DEMO_UNAVAILABLE，不回退实时采集。
export async function GET(_request: NextRequest, { params }: { params: Promise<{ demoId: string }> }) {
  try {
    const { demoId } = await params;
    return NextResponse.json(await ScreenerDemoService.get(demoId));
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'screener-demo');
  }
}
