import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { getAuthUser, requireScope, requireVerifiedEmail } from '@/lib/auth-server';
import { AppError, apiKeyCreateSchema, parseInput } from '@emeradar/core';

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

    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json({ type: 'about:blank', title: 'Plan Upgrade Required', status: 403, detail: 'Developer API access is not available in the launch plan.' }, { status: 403 });
    }

    const scopeError = requireScope(auth, 'api_keys:read');
    if (scopeError) return scopeError;

    const keys = await AuthService.listApiKeys(auth.user.id);
    return NextResponse.json({ keys });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    console.error('[user/api-keys] Error:', error);
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'API Keys Fetch Error',
        status: 500,
        detail: 'The API keys could not be loaded.',
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

    // Public API access is deferred from the launch contract. Keep the endpoint
    // available for admins so operations can still validate the integration.
    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Plan Upgrade Required',
          status: 403,
          detail: 'Developer API access is not available in the launch plan.',
        },
        { status: 403 }
      );
    }

    const scopeError = requireScope(auth, 'api_keys:write');
    if (scopeError) return scopeError;
    const verificationError = requireVerifiedEmail(auth);
    if (verificationError) return verificationError;

    const body = parseInput(apiKeyCreateSchema, await request.json().catch(() => ({})));
    const label = body.label?.trim() || 'Default Production Key';
    const allowedScopes = new Set([
      'opportunities:read', 'opportunities:write', 'reports:read', 'reports:export',
      'alerts:read', 'alerts:write', 'projects:read', 'projects:write',
      'api_keys:read', 'api_keys:write',
    ]);
    const scopes = Array.isArray(body.scopes) && body.scopes.length > 0
      ? body.scopes.filter((scope: unknown): scope is string => typeof scope === 'string' && allowedScopes.has(scope))
      : ['opportunities:read', 'reports:read', 'alerts:read'];
    if (scopes.length !== (Array.isArray(body.scopes) && body.scopes.length > 0 ? body.scopes.length : 3)) {
      return NextResponse.json({ type: 'about:blank', title: 'Invalid Scope', status: 400, detail: 'One or more requested scopes are not supported.' }, { status: 400 });
    }

    const result = await AuthService.createApiKey(auth.user.id, label, scopes);

    return NextResponse.json({
      apiKey: result.apiKey,
      rawSecretKey: result.rawSecretKey,
      message: 'API Key generated. Copy this secret key now as you will not be able to view it again.',
    });
  } catch (error) {
    console.error('[user/api-keys] Error:', error);
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'API Key Generation Error',
        status: 500,
        detail: 'The API key could not be generated.',
      },
      { status: 500 }
    );
  }
}
