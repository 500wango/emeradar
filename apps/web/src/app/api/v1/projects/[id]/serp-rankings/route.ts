import { NextRequest, NextResponse } from 'next/server';
import { RankingService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

/**
 * 无感 SERP 排名曲线（PRD F10、10 §4.5）。
 *
 * 只读：曲线由 S 管线在采集时顺带写入（`project_serp_rankings`），这里不做任何采集。
 * 因此这个端点可以随便刷新——它不会产生一次供应商调用，也不会扣任何配额。
 *
 * 每行是 `{ date, rank, matchedUrl, matchedVia }`；`rank: null` 是**正常取值**，
 * 表示当日未进入采集深度，而不是"那天没有记录"。丢掉这些行，入榜率的分母就没了。
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
    return NextResponse.json(await RankingService.getProjectRankings(id, auth.user.id));
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id/serp-rankings');
  }
}
