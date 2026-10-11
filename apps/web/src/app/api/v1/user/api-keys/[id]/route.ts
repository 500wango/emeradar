import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { getAuthUser, requireScope } from '@/lib/auth-server';
import { AppError } from '@emeradar/core';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'Authentication required to revoke API keys.',
        },
        { status: 401 }
      );
    }
    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json({ type: 'about:blank', title: 'Plan Upgrade Required', status: 403, detail: 'Developer API access is not available in the launch plan.' }, { status: 403 });
    }
    const scopeError = requireScope(auth, 'api_keys:write');
    if (scopeError) return scopeError;

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: 'Key ID is required.',
        },
        { status: 400 }
      );
    }

    await AuthService.revokeApiKey(auth.user.id, id);

    return NextResponse.json({
      ok: true,
      revokedId: id,
      message: 'API Key revoked successfully.',
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    console.error('[user/api-keys/revoke] Error:', error);
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Revoke Error',
        status: 500,
        detail: 'The API key could not be revoked.',
      },
      { status: 500 }
    );
  }
}
