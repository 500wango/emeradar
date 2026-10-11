import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';
import { adminSourceSchema, parseInput } from '@emeradar/core';
import { errorResponse } from '@/lib/api-errors';

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const sources = await AdminService.listSources();
    return NextResponse.json({ sources });
  } catch (err) {
    return errorResponse(err, 'admin/sources');
  }
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession({ requireAdmin: true });
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const body = parseInput(adminSourceSchema, await req.json().catch(() => ({})));

    if (body.action === 'toggle') {
      await AdminService.toggleSource(body.sourceId, body.isActive, session.user.id);
      return NextResponse.json({ success: true });
    }

    const newSource = await AdminService.addRssSource(body.name, body.url, session.user.id);
    return NextResponse.json({ success: true, source: newSource });
  } catch (err) {
    return errorResponse(err, 'admin/sources');
  }
}
