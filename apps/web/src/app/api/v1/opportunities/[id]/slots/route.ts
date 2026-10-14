import { NextRequest, NextResponse } from 'next/server';
import { SlotService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

/**
 * 槽位明细（10 §4.2）。
 *
 * **不按套餐裁剪**：还有多少位置是产品卖点的一部分，隐藏它等于把"这条机会值不值得
 * 抢"的判断从用户手里拿走（13 §3.2）。所以这里只要求读权限，不做 planCode 判断。
 *
 * 未登录也返回（`myClaim` 为 null）：公开机会页要能显示余量。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await getAuthUser(request);
    if (auth) {
      const scopeError = requireScope(auth, 'opportunities:read');
      if (scopeError) return scopeError;
    }
    const slots = await SlotService.getSlots(id, auth?.user.id);
    return NextResponse.json(slots);
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'opportunities/id/slots');
  }
}
