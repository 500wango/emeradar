import { NextRequest, NextResponse } from 'next/server';
import { AlertService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser, requireScope } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'alerts:read');
    if (scopeError) return scopeError;
    const userId = auth.user.id;
    const rules = await AlertService.listAlertRules(userId);
    const notifications = await AlertService.listNotifications(userId);
    return NextResponse.json({ rules, notifications });
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Error', status: 500, detail: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'alerts:write');
    if (scopeError) return scopeError;
    const userId = auth.user.id;
    const body = await request.json();

    if (!body.opportunityId || !body.ruleType) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation Error', status: 400, detail: 'opportunityId and ruleType are required' },
        { status: 400 }
      );
    }

    const rule = await AlertService.createAlertRule(userId, {
      opportunityId: body.opportunityId,
      ruleType: body.ruleType,
      frequency: body.frequency,
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Alert Error', status: 500, detail: error.message },
      { status: 500 }
    );
  }
}
