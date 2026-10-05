import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { task } = body;
    if (!task || !['discover', 'generate-intents', 'validate-intents', 'run-daily'].includes(task)) {
      return NextResponse.json({ error: 'Invalid or missing task name' }, { status: 400 });
    }

    const result = await AdminService.triggerTask(task);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[admin/pipeline/trigger] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
