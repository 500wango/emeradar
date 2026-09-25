import { NextRequest, NextResponse } from 'next/server';
import { OpportunityService } from '@emeradar/services';
import { AppError } from '@emeradar/core';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const verdict = searchParams.get('verdict') as any;
    const archetype = searchParams.get('archetype') as any;
    const executionClass = searchParams.get('execution_class') as any;
    const minD = searchParams.get('min_d') ? parseInt(searchParams.get('min_d')!, 10) : undefined;
    const search = searchParams.get('search') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 20;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0;

    const data = await OpportunityService.listFeedCards({
      verdict,
      archetype,
      executionClass,
      minD,
      search,
      limit,
      offset,
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
