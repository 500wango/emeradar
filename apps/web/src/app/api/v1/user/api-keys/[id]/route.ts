import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { getAuthUser } from '@/lib/auth-server';

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
  } catch (error: any) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Revoke Error',
        status: 500,
        detail: error.message,
      },
      { status: 500 }
    );
  }
}
