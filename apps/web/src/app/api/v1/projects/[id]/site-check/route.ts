import { NextRequest, NextResponse } from 'next/server';
import { ProjectService } from '@emeradar/services';
import { getAuthUser, requireScope } from '@/lib/auth-server';
import { AppError } from '@emeradar/core';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;
    const { id } = await params;
    return NextResponse.json(await ProjectService.inspectProjectSite(id, auth.user.id));
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    console.error('[projects/site-check] Error:', error);
    return NextResponse.json(
      { type: 'about:blank', title: 'Site check failed', status: 502, detail: 'The project site could not be inspected.' },
      { status: 502 }
    );
  }
}
