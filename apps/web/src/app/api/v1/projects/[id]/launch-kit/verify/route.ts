import { NextRequest, NextResponse } from 'next/server';
import { LaunchKitService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

/**
 * 复核一份已冻结的点火包（09 §5.3 硬约束 1）。
 *
 * 用同一份输入重新装配一遍，比对 `content_hash`。这是"同一份输入必得同一份交付物"
 * 这句承诺唯一能被**验证**而不是只能被相信的地方——三个版本头让用户知道输入是什么，
 * 这个端点让他知道产物确实对得上。
 *
 * 可复核的范围是"除 LLM 叙述外的一切"：叙述不可确定性重算，所以复核时喂回去的是
 * 库里冻结的那一段。这条边界必须说清楚，否则这个端点会给人一种"整份产物都可重算"
 * 的错觉。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    }
    const scopeError = requireScope(auth, 'projects:read');
    if (scopeError) return scopeError;
    const { id } = await params;
    return NextResponse.json(await LaunchKitService.verify(id, auth.user.id));
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id/launch-kit/verify');
  }
}
