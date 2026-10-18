import { NextRequest, NextResponse } from 'next/server';
import { CredentialService } from '@emeradar/services';
import { AppError, parseInput, credentialSchema } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

/**
 * 凭证状态与历次校验结果（09 §8、10 §4.5）。
 *
 * v3.1 的凭证是 GO 之后的可选动作：没有截止时间、没有重试次数上限，返回值里也
 * 没有任何质押期限字段——那套机制已经整体拆除。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:read');
    if (scopeError) return scopeError;
    const { id } = await params;
    return NextResponse.json(await CredentialService.getCredentials(id, auth.user.id));
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id/credentials');
  }
}

/**
 * 提交一枚上线凭证（09 §8）。
 *
 * 探针同步跑——校验的是**实际取回的内容**，不是用户填的字段。校验失败返回 422 并
 * 附上探针取回的关键字段；资源不释放、配额不退还，用户可以改完页面再交一次。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;
    const { id } = await params;
    const body = parseInput(credentialSchema, await request.json().catch(() => ({})));
    const result = await CredentialService.submitCredential(id, auth.user.id, {
      credentialType: body.credentialType,
      url: body.url,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id/credentials');
  }
}
