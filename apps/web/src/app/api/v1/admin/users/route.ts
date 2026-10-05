import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const role = searchParams.get('role') || undefined;
  const tier = searchParams.get('tier') || undefined;
  const status = searchParams.get('status') || undefined;
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  try {
    const res = await AdminService.listUsers({ search, role, tier, status, limit, offset });
    return NextResponse.json(res);
  } catch (err: any) {
    console.error('[admin/users/list] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession({ requireAdmin: true });
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { email, password, displayName, role, tier } = body;
    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const res = await AdminService.createUserByAdmin(session.user.id, {
      email,
      password,
      displayName,
      role,
      tier,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (err: any) {
    console.error('[admin/users/create] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: err.status || 500 });
  }
}
