import { NextRequest, NextResponse } from 'next/server';
import { ProjectService } from '@emeradar/services';
import { AppError, parseGscSyncInput, parseInput, projectUpdateSchema } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:read');
    if (scopeError) return scopeError;
    const { id } = await params;
    return NextResponse.json(await ProjectService.getProjectDetail(id, auth.user.id));
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;
    const { id } = await params;
    const sync = parseGscSyncInput(await request.json().catch(() => ({})));
    const result = sync.kind === 'daily'
      ? await ProjectService.syncGscSearchAnalytics(id, auth.user.id, sync.rows)
      : await ProjectService.upsertGscWeeklyDetails(id, auth.user.id, sync.rows);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;
    const { id } = await params;
    await ProjectService.disconnectGsc(id, auth.user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id');
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;
    const { id } = await params;
    const body = parseInput(projectUpdateSchema, await request.json().catch(() => ({})));

    if (body.status) {
      return NextResponse.json(
        await ProjectService.updateProjectStatus(id, auth.user.id, body.status, body.domain)
      );
    }
    if (!body.propertyUrl) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation Error', status: 400, detail: 'propertyUrl or status is required' },
        { status: 400 }
      );
    }
    await ProjectService.selectGscProperty(id, auth.user.id, body.propertyUrl);
    return NextResponse.json({ propertyUrl: body.propertyUrl, status: 'CONNECTED' });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id');
  }
}
