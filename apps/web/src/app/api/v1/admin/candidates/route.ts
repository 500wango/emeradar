import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';
import { candidateModerateSchema, parseInput } from '@emeradar/core';
import { errorResponse } from '@/lib/api-errors';

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
  } catch (err) {
    return errorResponse(err, 'admin/candidates');
  }
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession({ requireAdmin: true });
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const { opportunityId, action } = parseInput(
      candidateModerateSchema,
      await req.json().catch(() => ({}))
    );

    const res = await AdminService.moderateCandidate(opportunityId, action, session.user.id);
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err, 'admin/candidates/moderate');
  }
}
