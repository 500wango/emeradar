import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';
import { adminUserCreateSchema, parseInput } from '@emeradar/core';
import { errorResponse } from '@/lib/api-errors';

export async function GET(req: NextRequest) {
  // The user directory carries personal data; ANALYST (research role) has no
  // operational need for it, so the listing is ADMIN-only.
  const session = await getAdminSession({ requireAdmin: true });
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
  } catch (err) {
    return errorResponse(err, 'admin/users/list');
  }
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession({ requireAdmin: true });
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const { email, password, displayName, role, tier } = parseInput(
      adminUserCreateSchema,
      await req.json().catch(() => ({}))
    );

    const res = await AdminService.createUserByAdmin(session.user.id, {
      email,
      password,
      displayName,
      role,
      tier,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'admin/users/create');
  }
}
