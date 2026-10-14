import { NextRequest, NextResponse } from 'next/server';
import { StealthLockService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser } from '@/lib/auth-server';

/**
 * 我持有的买断与剩余保护天数（10 §4.5b、Epic 1.14）。
 *
 * 路径写在 `/me/` 而不是仓库里既有的 `/user/`（preferences、api-keys）：`docs/10`
 * 是端点契约的权威，它写的是 `/me/stealth-locks`，且新路径不与任何既有端点冲突。
 *
 * 这里**不需要**可见性判据：查询按 `sl.user_id = $1` 收窄，返回的全是调用者自己
 * 买下的东西，他本来就能看见。`VOID`（未付款占位作废）不出现——那条锁从未成交，
 * 列出来只会让用户以为买成功了；`EXPIRED`（60 天期满）保留，它是一段真实的历史。
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Authentication required.' },
        { status: 401 }
      );
    }

    const locks = await StealthLockService.getMyLocks(auth.user.id);
    return NextResponse.json({
      locks: locks.map((lock) => ({
        lock_id: lock.lockId,
        opportunity_id: lock.opportunityId,
        // 持有者看到的是**真实标题**：这正是他买下的东西，打码是给外人看的。
        opportunity_title: lock.opportunityTitle,
        masked_label: lock.maskedLabel,
        locked_at: lock.lockedAt,
        unlock_at: lock.unlockAt,
        remaining_days: lock.remainingDays,
        status: lock.status,
      })),
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    console.error('[me/stealth-locks] Error:', error);
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Stealth Locks Fetch Error',
        status: 500,
        detail: 'Your stealth locks could not be loaded.',
      },
      { status: 500 }
    );
  }
}
