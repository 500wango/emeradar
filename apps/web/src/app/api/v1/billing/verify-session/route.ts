import { NextRequest, NextResponse } from 'next/server';
import { StripeService } from '@emeradar/services';

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json().catch(() => ({}));
    if (!sessionId) {
      return NextResponse.json({ success: false, detail: 'Missing sessionId' }, { status: 400 });
    }
    const verified = await StripeService.verifyAndActivateSession(sessionId);
    return NextResponse.json({ success: verified });
  } catch (error: any) {
    return NextResponse.json({ success: false, detail: error.message }, { status: 500 });
  }
}
