import { NextRequest, NextResponse } from 'next/server';
import { CustomQueryRadarService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope, requireVerifiedEmail } from '@/lib/auth-server';

/** 自定义词 7 天雷达（PRD F3 第 2 阶段、12 §2）。 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'opportunities:read');
    if (scopeError) return scopeError;

    const items = await CustomQueryRadarService.list(auth.user.id);
    return NextResponse.json({ items });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'custom-queries/radar');
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'opportunities:read');
    if (scopeError) return scopeError;
    const verificationError = requireVerifiedEmail(auth);
    if (verificationError) return verificationError;

    const body = await request.json().catch(() => ({}));
    if (typeof body?.opportunityId !== 'string' || body.opportunityId.trim().length === 0) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation Error', status: 400, detail: 'opportunityId is required.' },
        { status: 400 }
      );
    }

    const radar = await CustomQueryRadarService.enroll(auth.user.id, body.opportunityId.trim());
    return NextResponse.json(radar, { status: 201 });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'custom-queries/radar');
  }
}
