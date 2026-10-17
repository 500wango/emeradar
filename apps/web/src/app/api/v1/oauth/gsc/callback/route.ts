import { NextRequest, NextResponse } from 'next/server';
import { ProjectService } from '@emeradar/services';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';
import { AppError } from '@emeradar/core';

/**
 * 统一的 GSC OAuth 回调端点。
 *
 * Google OAuth 不支持通配符回调 URL，旧版端点 `/projects/[id]/gsc/callback`
 * 要求为每个项目预先注册一个回调 URL，无法扩展。现在项目 ID 从 state
 * 参数中解析，只需在 Google Cloud Console 注册一个固定 URL。
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;

    const code = request.nextUrl.searchParams.get('code');
    const state = request.nextUrl.searchParams.get('state');
    const oauthError = request.nextUrl.searchParams.get('error');

    if (oauthError) {
      // state 格式: base64url(projectId:random)
      const projectId = state ? ProjectService.extractProjectIdFromState(state) : null;
      return NextResponse.redirect(
        new URL(projectId ? `/projects/${projectId}?gsc=denied` : '/projects?gsc=denied', request.url)
      );
    }

    if (!code || !state) {
      return NextResponse.json({ type: 'about:blank', title: 'Invalid OAuth request', status: 400 }, { status: 400 });
    }

    const projectId = ProjectService.extractProjectIdFromState(state);
    if (!projectId) {
      return NextResponse.json({ type: 'about:blank', title: 'Invalid OAuth state', status: 400 }, { status: 400 });
    }

    // 验证并消费 state
    if (!(await ProjectService.consumeGscOAuthState(projectId, auth.user.id, state))) {
      return NextResponse.json({ type: 'about:blank', title: 'Invalid OAuth state', status: 400 }, { status: 400 });
    }

    const redirectUri = process.env.GSC_REDIRECT_URI;
    if (!redirectUri) {
      return NextResponse.json({ type: 'about:blank', title: 'OAuth not configured', status: 503 }, { status: 503 });
    }

    await ProjectService.completeGscAuthorization(projectId, auth.user.id, code, redirectUri);

    const response = NextResponse.redirect(new URL(`/projects/${projectId}?gsc=select-property`, request.url));
    response.cookies.delete(`gsc_oauth_state_${projectId}`);
    return response;
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'oauth/gsc/callback');
  }
}
