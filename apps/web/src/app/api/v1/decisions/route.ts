import { NextRequest, NextResponse } from 'next/server';
import { DecisionService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    }
    const userId = auth.user.id;
    const body = await request.json().catch(() => ({}));
    const reasons = Array.isArray(body.reasons) ? body.reasons.map(String) : [];

    if (!body.opportunityId || typeof body.opportunityId !== 'string') {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Validation Error',
          status: 400,
          detail: 'opportunityId is required.',
        },
        { status: 400 }
      );
    }

    const decision = await DecisionService.pass(userId, body.opportunityId, reasons);
    return NextResponse.json(decision, { status: 201 });
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Decision Error',
        status: error.status || 500,
        detail: error.message || 'Could not record the decision.',
      },
      { status: error.status || 500 }
    );
  }
}
