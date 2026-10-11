import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';
import { errorResponse } from '@/lib/api-errors';

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const overview = await AdminService.getPipelineOverview();
    return NextResponse.json(overview);
  } catch (err) {
    return errorResponse(err, 'admin/overview');
  }
}
