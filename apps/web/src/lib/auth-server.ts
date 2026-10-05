import { NextRequest } from 'next/server';
import { AuthService, UserProfile, UserPreferencesData } from '@emeradar/services';

export interface SessionContext {
  user: UserProfile;
  preferences: UserPreferencesData;
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
        };
      }
    }
  }

  // 2. Check session cookie
  const token = request.cookies.get('emeradar_session')?.value;
  if (!token) {
    return null;
  }
  return await AuthService.getSessionUser(token);
}
