import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const { password } = body;

    const res = await AdminService.resetUserPassword(id, password);
    return NextResponse.json(res);
  } catch (err: any) {
    console.error('[admin/users/reset-password] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: err.status || 400 }
    );
  }
}
