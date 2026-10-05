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
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  try {
    const res = await AdminService.listCandidates({ search, limit, offset });
    return NextResponse.json(res);
  } catch (err: any) {
    console.error('[admin/candidates] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { opportunityId, action } = body;
    if (!opportunityId || !action) {
      return NextResponse.json({ error: 'Missing opportunityId or action' }, { status: 400 });
    }

    const res = await AdminService.moderateCandidate(opportunityId, action);
    return NextResponse.json(res);
  } catch (err: any) {
    console.error('[admin/candidates/moderate] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
