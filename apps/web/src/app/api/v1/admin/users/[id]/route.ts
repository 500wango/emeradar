import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';
import { adminUserUpdateSchema, parseInput } from '@emeradar/core';
import { errorResponse } from '@/lib/api-errors';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Individual user records carry personal data; ADMIN-only, as with the list.
  const session = await getAdminSession({ requireAdmin: true });
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const user = await AdminService.getUserById(id);
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    return NextResponse.json(user);
  } catch (err) {
    return errorResponse(err, 'admin/users/get');
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession({ requireAdmin: true });
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const { role, tier, status } = parseInput(adminUserUpdateSchema, await req.json().catch(() => ({})));

    const updated = await AdminService.updateUser(session.user.id, id, {
      role,
      tier,
      status,
    });

    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err, 'admin/users/update');
  }
}
