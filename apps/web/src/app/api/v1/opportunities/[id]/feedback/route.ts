import { NextRequest, NextResponse } from 'next/server';
import { InboxService, type InboxFeedbackReason } from '@emeradar/services';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

const REASONS = new Set<InboxFeedbackReason>([
  'INTERESTED',
  'SAVED',
  'NOT_OPPORTUNITY',
  'ALREADY_BUILT',
  'CANNOT_BUILD',
]);

/** 用户对某条机会的反馈：用于 Inbox 去噪与后续校准，不修改已封存的 verdict。 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    }
    const scopeError = requireScope(auth, 'opportunities:write');
    if (scopeError) return scopeError;

    const body = (await request.json().catch(() => ({}))) as {
      reason?: string;
      note?: string | null;
    };
    if (!body.reason || !REASONS.has(body.reason as InboxFeedbackReason)) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Invalid feedback reason', status: 400 },
        { status: 400 }
      );
    }

    const { id } = await params;
    await InboxService.recordFeedback(
      auth.user.id,
      id,
      body.reason as InboxFeedbackReason,
      typeof body.note === 'string' ? body.note.slice(0, 500) : null
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return internalErrorResponse(error, 'opportunities/id/feedback');
  }
}
