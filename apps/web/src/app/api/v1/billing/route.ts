import { NextRequest, NextResponse } from 'next/server';
import { EntitlementService } from '@emeradar/services';
import { AppError } from '@emeradar/core';

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id') || 'usr_demo_pro';
    const entitlements = await EntitlementService.getUserEntitlements(userId);
    return NextResponse.json(entitlements);
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
