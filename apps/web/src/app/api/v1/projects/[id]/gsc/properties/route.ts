import { NextRequest, NextResponse } from 'next/server';
import { ProjectService } from '@emeradar/services';
import { AppError, gscPropertySchema, parseInput } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:read');
    if (scopeError) return scopeError;
    return NextResponse.json(await ProjectService.getGscProperties((await params).id, auth.user.id));
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/gsc/properties');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;
    const { propertyUrl } = parseInput(gscPropertySchema, await request.json().catch(() => ({})));
    await ProjectService.selectGscProperty((await params).id, auth.user.id, propertyUrl);
    return NextResponse.json({ propertyUrl, status: 'CONNECTED' });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/gsc/properties');
  }
}
