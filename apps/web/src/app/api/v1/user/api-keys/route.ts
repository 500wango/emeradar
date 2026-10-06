import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { getAuthUser, requireScope } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'Authentication required to view API keys.',
        },
        { status: 401 }
      );
    }

    const scopeError = requireScope(auth, 'api_keys:read');
    if (scopeError) return scopeError;

    const keys = await AuthService.listApiKeys(auth.user.id);
    return NextResponse.json({ keys });
  } catch (error: any) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'API Keys Fetch Error',
        status: 500,
        detail: error.message,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'Authentication required to generate API keys.',
        },
        { status: 401 }
      );
    }

    // RBAC & Entitlement check: Free users cannot create API keys (docs/13 §3.2 api_access)
    if (auth.user.tier === 'FREE' && auth.user.role === 'USER') {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Plan Upgrade Required',
          status: 403,
          detail: 'Developer API key access is not available on the Free plan. Please upgrade to Pro or Team.',
        },
        { status: 403 }
      );
    }

    const scopeError = requireScope(auth, 'api_keys:write');
    if (scopeError) return scopeError;

    const body = await request.json().catch(() => ({}));
    const label = body.label?.trim() || 'Default Production Key';
    const scopes = Array.isArray(body.scopes) && body.scopes.length > 0 
      ? body.scopes 
      : ['opportunities:read', 'reports:read', 'alerts:read'];

    const result = await AuthService.createApiKey(auth.user.id, label, scopes);

    return NextResponse.json({
      apiKey: result.apiKey,
      rawSecretKey: result.rawSecretKey,
      message: 'API Key generated. Copy this secret key now as you will not be able to view it again.',
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'API Key Generation Error',
        status: 500,
        detail: error.message,
      },
      { status: 500 }
    );
  }
}
