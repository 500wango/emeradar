import { cookies } from 'next/headers';
import { AuthService } from '@emeradar/services';

export async function getAdminSession(
  options: { requireAdmin?: boolean } = {}
) {
  const cookieStore = await cookies();
  const token = cookieStore.get('emeradar_session')?.value;
  if (!token) return null;
  const session = await AuthService.getSessionUser(token);
  if (!session) return null;
  const role = session.user.role;
  if (role !== 'ADMIN' && role !== 'ANALYST') return null;
  // Privileged operations (role changes, password resets, user creation) must be
  // restricted to full ADMINs; ANALYST is treated as a read/ops-only staff role.
  if (options.requireAdmin && role !== 'ADMIN') return null;
  return session;
}
