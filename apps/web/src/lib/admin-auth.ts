import { cookies } from 'next/headers';
import { AuthService } from '@emeradar/services';

export async function getAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('emeradar_session')?.value;
  if (!token) return null;
  const session = await AuthService.getSessionUser(token);
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'ANALYST')) {
    return null;
  }
  return session;
}
