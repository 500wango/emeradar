import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminService } from '@emeradar/services';
import { parseInput, pipelineTriggerSchema } from '@emeradar/core';
import { errorResponse } from '@/lib/api-errors';

export async function POST(req: NextRequest) {
  const session = await getAdminSession({ requireAdmin: true });
  if (!session) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const { task } = parseInput(pipelineTriggerSchema, await req.json().catch(() => ({})));

    const result = await AdminService.triggerTask(task, session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, 'admin/pipeline/trigger');
  }
}
