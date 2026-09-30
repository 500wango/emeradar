import { NextRequest, NextResponse } from 'next/server';
import { ProjectService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser } from '@/lib/auth-server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const { id } = await params;
    const code = request.nextUrl.searchParams.get('code');
    const state = request.nextUrl.searchParams.get('state');
    const oauthError = request.nextUrl.searchParams.get('error');
    if (oauthError) return NextResponse.redirect(new URL(`/projects/${id}?gsc=denied`, request.url));
    if (!code || !state || !(await ProjectService.consumeGscOAuthState(id, auth.user.id, state))) return NextResponse.json({ type: 'about:blank', title: 'Invalid OAuth state', status: 400 });
    const redirectUri = process.env.GSC_REDIRECT_URI;
    if (!redirectUri) return NextResponse.json({ type: 'about:blank', title: 'OAuth not configured', status: 503 });
    await ProjectService.completeGscAuthorization(id, auth.user.id, code, redirectUri);
    const response = NextResponse.redirect(new URL(`/projects/${id}?gsc=select-property`, request.url));
    response.cookies.delete(`gsc_oauth_state_${id}`);
    return response;
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return NextResponse.json({ type: 'about:blank', title: 'Error', status: 500, detail: error.message }, { status: 500 });
  }
}
