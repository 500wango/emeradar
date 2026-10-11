import { NextRequest, NextResponse } from 'next/server';
import { DecisionService } from '@emeradar/services';
import { AppError, decisionSchema, parseInput } from '@emeradar/core';
import { getAuthUser, requireScope, requireVerifiedEmail } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    }
    const scopeError = requireScope(auth, 'opportunities:write');
    if (scopeError) return scopeError;
    const verificationError = requireVerifiedEmail(auth);
    if (verificationError) return verificationError;
    const userId = auth.user.id;
    const body = parseInput(decisionSchema, await request.json().catch(() => ({})));
    const reasons = body.reasons ?? [];

    const decision = await DecisionService.pass(userId, body.opportunityId, reasons);
    return NextResponse.json(decision, { status: 201 });
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    console.error('[api] Unhandled error:', error);
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Decision Error',
        status: error.status || 500,
        detail: 'Could not record the decision.',
      },
      { status: error.status || 500 }
    );
  }
}
