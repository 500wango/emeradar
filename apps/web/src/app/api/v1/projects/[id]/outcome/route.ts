import { NextRequest, NextResponse } from 'next/server';
import { ProjectOutcomeService, type ProjectOutcomeStatus } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

const STATUSES = new Set<ProjectOutcomeStatus>([
  'BUILDING',
  'LAUNCHED',
  'ABANDONED',
  'NO_TRACTION',
  'EARLY_TRACTION',
  'TRACTION',
]);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(_request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const { id } = await params;
    return NextResponse.json(await ProjectOutcomeService.getState(id, auth.user.id));
  } catch (error) {
    return internalErrorResponse(error, 'projects/id/outcome');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;

    const body = (await request.json().catch(() => ({}))) as { status?: string; note?: string | null };
    if (!body.status || !STATUSES.has(body.status as ProjectOutcomeStatus)) {
      return NextResponse.json({ type: 'about:blank', title: 'Invalid outcome status', status: 400 }, { status: 400 });
    }
    const { id } = await params;
    const checkin = await ProjectOutcomeService.record(
      id,
      auth.user.id,
      body.status as ProjectOutcomeStatus,
      typeof body.note === 'string' ? body.note.slice(0, 1000) : null
    );
    return NextResponse.json({ success: true, checkin }, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id/outcome');
  }
}
