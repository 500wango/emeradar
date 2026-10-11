import { NextRequest, NextResponse } from 'next/server';
import { StripeService } from '@emeradar/services';
import { AppError, billingSessionSchema, parseInput } from '@emeradar/core';
import { getAuthUser } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ success: false, detail: 'Authentication required.' }, { status: 401 });
    const { sessionId } = parseInput(billingSessionSchema, await request.json().catch(() => ({})));
    const verified = await StripeService.verifyAndActivateSession(sessionId, auth.user.id);
    return NextResponse.json({ success: verified });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    console.error('[billing/verify-session] Error:', error);
    return NextResponse.json(
      { success: false, detail: 'The checkout session could not be verified.' },
      { status: 500 }
    );
  }
}
