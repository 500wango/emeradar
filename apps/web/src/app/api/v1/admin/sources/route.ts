import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const sources = await AdminService.listSources();
    return NextResponse.json({ sources });
  } catch (err: any) {
    console.error('[admin/sources] Error:', err);
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
    const { action } = body;

    if (action === 'toggle') {
      const { sourceId, isActive } = body;
      if (!sourceId || typeof isActive !== 'boolean') {
        return NextResponse.json({ error: 'Missing sourceId or isActive' }, { status: 400 });
      }
      await AdminService.toggleSource(sourceId, isActive);
      return NextResponse.json({ success: true });
    }

    if (action === 'add') {
      const { name, url } = body;
      if (!name || !url) {
        return NextResponse.json({ error: 'Missing name or url' }, { status: 400 });
      }
      const newSource = await AdminService.addRssSource(name, url);
      return NextResponse.json({ success: true, source: newSource });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('[admin/sources] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
