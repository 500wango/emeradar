import { NextRequest, NextResponse } from 'next/server';
import { StakeService } from '@emeradar/services';
import { AppError, parseInput, stakeCredentialSchema } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

/** 当前质押状态、期限与历次校验结果（10 §4.5）。 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:read');
    if (scopeError) return scopeError;
    const { id } = await params;
    return NextResponse.json(await StakeService.getStakeStatus(id, auth.user.id));
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id/stake');
  }
}

/**
 * 提交承诺质押凭证（09 §8）。
 *
 * 探针同步跑——校验的是**实际取回的内容**，不是用户填的字段。校验失败返回 422 并
 * 附上探针取回的关键字段，槽位**不释放**：用户还有到 `stake_deadline_at` 为止的
 * 时间改页面或换凭证，把一次填错 URL 直接等同于逾期会让这条规则变得不可用。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;
    const { id } = await params;
    const body = parseInput(stakeCredentialSchema, await request.json().catch(() => ({})));
    const result = await StakeService.submitCredential(id, auth.user.id, {
      credentialType: body.credentialType,
      url: body.url,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id/stake');
  }
}
