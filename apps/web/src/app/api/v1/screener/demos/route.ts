import { NextResponse } from 'next/server';
import { ScreenerDemoService } from '@emeradar/services';
import { internalErrorResponse } from '@/lib/api-errors';

// 匿名可读（10 §4.3b）：只列词，不触发任何采集。
export async function GET() {
  try {
    return NextResponse.json({ demos: await ScreenerDemoService.list() });
  } catch (error) {
    return internalErrorResponse(error, 'screener-demos');
  }
}
