import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
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
  } catch (err: any) {
    console.error('[admin/users/get] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
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
    const body = await req.json();
    const { role, tier, status } = body;

    const updated = await AdminService.updateUser(session.user.id, id, {
      role,
      tier,
      status,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('[admin/users/update] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: err.status || 400 }
    );
  }
}
