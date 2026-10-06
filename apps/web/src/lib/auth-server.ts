import { NextRequest, NextResponse } from 'next/server';
import { AuthService, UserProfile, UserPreferencesData } from '@emeradar/services';

export interface SessionContext {
  user: UserProfile;
  preferences: UserPreferencesData;
  authMethod: 'session' | 'api_key';
  scopes?: string[];
  keyId?: string;
}

/**
 * Checks whether the current authenticated context possesses the requested permission scope.
 * Interactive user sessions have full access (governed by RBAC/tier).
 * API keys strictly require the matching scope or a resource wildcard (e.g. 'projects:*' or '*').
 */
export function hasScope(auth: SessionContext, requiredScope: string): boolean {
  if (auth.authMethod === 'session') {
    return true;
  }
  if (!auth.scopes || !Array.isArray(auth.scopes)) {
    return false;
  }
  if (auth.scopes.includes('*') || auth.scopes.includes('admin:all')) {
    return true;
  }
  const [resource] = requiredScope.split(':');
  return (
    auth.scopes.includes(requiredScope) ||
    auth.scopes.includes(`${resource}:*`)
  );
}

/**
 * Helper to enforce scope: returns a 403 Forbidden NextResponse if the scope is missing, or null if allowed.
 */
export function requireScope(auth: SessionContext, requiredScope: string): NextResponse | null {
  if (!hasScope(auth, requiredScope)) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Insufficient Scope',
        status: 403,
        detail: `API key lacks the required scope: '${requiredScope}'. Granted scopes: [${(auth.scopes || []).join(', ')}]`,
      },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Extracts and validates the authenticated user from the request session cookie
 * or Authorization: Bearer <emd_live_...> header
 */
export async function getAuthUser(request: NextRequest): Promise<SessionContext | null> {
  // 1. Check Authorization: Bearer <token> header for Developer API access
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const rawKey = authHeader.slice(7).trim();
    if (rawKey.startsWith('emd_live_')) {
      const apiKeyAuth = await AuthService.authenticateApiKey(rawKey);
      if (apiKeyAuth) {
        return {
          user: apiKeyAuth.user,
          preferences: apiKeyAuth.preferences,
          authMethod: 'api_key',
          scopes: apiKeyAuth.scopes,
          keyId: apiKeyAuth.keyId,
        };
      }
    }
  }

  // 2. Check session cookie
  const token = request.cookies.get('emeradar_session')?.value;
  if (!token) {
    return null;
  }
  const sessionUser = await AuthService.getSessionUser(token);
  if (!sessionUser) return null;

  return {
    user: sessionUser.user,
    preferences: sessionUser.preferences,
    authMethod: 'session',
    scopes: ['*'],
  };
}
