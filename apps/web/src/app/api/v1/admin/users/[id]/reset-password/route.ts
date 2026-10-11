import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';
import { parseInput, resetPasswordSchema } from '@emeradar/core';
import { errorResponse } from '@/lib/api-errors';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession({ requireAdmin: true });
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const { password } = parseInput(resetPasswordSchema, await req.json().catch(() => ({})));

    const res = await AdminService.resetUserPassword(session.user.id, id, password);
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err, 'admin/users/reset-password');
  }
}
