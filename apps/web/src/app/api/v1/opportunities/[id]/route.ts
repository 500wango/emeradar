import { NextRequest, NextResponse } from 'next/server';
import { OpportunityService } from '@emeradar/services';
import { AppError } from '@emeradar/core';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await OpportunityService.getOpportunityDetail(id);
    return NextResponse.json(data);
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Error', status: 500, detail: error.message },
      { status: 500 }
    );
  }
}
