import { NextRequest } from 'next/server';
import { AuthService, UserProfile, UserPreferencesData } from '@emeradar/services';

export interface SessionContext {
  user: UserProfile;
  preferences: UserPreferencesData;
}

/**
 * Extracts and validates the authenticated user from the request session cookie
 */
export async function getAuthUser(request: NextRequest): Promise<SessionContext | null> {
  const token = request.cookies.get('emeradar_session')?.value;
  if (!token) {
    return null;
  }
  return await AuthService.getSessionUser(token);
}
