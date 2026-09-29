import { NextRequest, NextResponse } from 'next/server';
import { EntitlementService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const userId = auth.user.id;
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
