import { NextRequest, NextResponse } from 'next/server';
import { DecisionService } from '@emeradar/services';
import { AppError, goSchema, parseInput } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope, requireVerifiedEmail } from '@/lib/auth-server';

/**
 * 原子 GO（ADR-018、10 §4.3）：一个事务内完成「占槽 + 扣月度导出配额 + 建 Project
 * + 解锁该形态点火包」。
 *
 * 这里**不允许异步化**。把 GO 拆成"先返回 202、后台建项目"会让"只有一个并发请求
 * 成功"这条保证失效——而那正是产品定价的前提（10 §4.3）。
 *
 * scope 用的是 `projects:write`，而不是 10 §2 写的那三个（`projects:write` +
 * `reports:generate` + `launch_kits:read`）：后两个目前**无法被授予**
 * （`AuthService.apiKeyScopes` 里没有它们，而点火包端点属于 Epic 1.9）。要求一个
 * 谁都拿不到的 scope 会让所有 API Key 调用 403，那不是收紧而是关停。等点火包端点
 * 落地时一并补齐三个 scope。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    }
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;
    const verificationError = requireVerifiedEmail(auth);
    if (verificationError) return verificationError;

    const { id } = await params;
    const body = parseInput(goSchema, await request.json().catch(() => ({})));

    const result = await DecisionService.goAndExport(auth.user.id, {
      opportunityId: id,
      archetype: body.archetype,
      verdictId: body.verdictId,
      reportId: body.reportId,
      credential: body.credential,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'opportunities/id/go');
  }
}
