import { NextRequest, NextResponse } from 'next/server';
import { StripeService } from '@emeradar/services';
import { getAuthUser } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ success: false, detail: 'Authentication required.' }, { status: 401 });
    const { sessionId } = await request.json().catch(() => ({}));
    if (!sessionId) {
      return NextResponse.json({ success: false, detail: 'Missing sessionId' }, { status: 400 });
    }
    const verified = await StripeService.verifyAndActivateSession(sessionId, auth.user.id);
    return NextResponse.json({ success: verified });
  } catch (error: any) {
    return NextResponse.json({ success: false, detail: error.message }, { status: 500 });
  }
}
