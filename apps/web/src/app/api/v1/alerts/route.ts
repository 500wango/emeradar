import { NextRequest, NextResponse } from 'next/server';
import { AlertService } from '@emeradar/services';
import { AppError, alertRuleSchema, parseInput } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope, requireVerifiedEmail } from '@/lib/auth-server';

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
    return internalErrorResponse(error, 'alerts');
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'alerts:write');
    if (scopeError) return scopeError;
    const verificationError = requireVerifiedEmail(auth);
    if (verificationError) return verificationError;
    const userId = auth.user.id;
    // `opportunityId` and `ruleType` are both required by the schema.
    const body = parseInput(alertRuleSchema, await request.json().catch(() => ({})));

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
    return internalErrorResponse(error, 'alerts');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'alerts:write');
    if (scopeError) return scopeError;
    const ruleId = request.nextUrl.searchParams.get('ruleId');
    if (!ruleId) return NextResponse.json({ type: 'about:blank', title: 'Validation Error', status: 400, detail: 'ruleId is required' }, { status: 400 });
    await AlertService.deleteAlertRule(auth.user.id, ruleId);
    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'alerts');
  }
}
