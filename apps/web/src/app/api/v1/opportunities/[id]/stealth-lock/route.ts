import { NextRequest, NextResponse } from 'next/server';
import { StealthLockService } from '@emeradar/services';
import { AppError, parseInput, stealthLockPurchaseSchema } from '@emeradar/core';
import { getAuthUser, requireScope } from '@/lib/auth-server';

/**
 * 处女地独占买断（10 §4.5b、Epic 1.14）。
 *
 * 两个方法都要求登录。这不只是为了鉴权——`GET` 的可见性判据需要一个"你是谁"才能
 * 回答，未登录时它对一切保护期内的机会都会 404（见 `getAvailability`）。
 */

function errorResponse(error: unknown, scope: string) {
  if (error instanceof AppError) {
    return NextResponse.json(error.toRFC9457(), { status: error.status });
  }
  console.error(`[${scope}] Error:`, error);
  return NextResponse.json(
    {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'The stealth lock request could not be completed.',
    },
    { status: 500 }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Authentication required.' },
        { status: 401 }
      );
    }
    const scopeError = requireScope(auth, 'opportunities:read');
    if (scopeError) return scopeError;

    const { id } = await params;
    const availability = await StealthLockService.getAvailability(id, auth.user.id);
    return NextResponse.json({
      available: availability.available,
      claimed_total: availability.claimedTotal,
      price: availability.price,
      duration_days: availability.durationDays,
      locked: availability.locked,
      held_by_me: availability.heldByMe,
      pending: availability.pending
        ? { lock_id: availability.pending.lockId, checkout_url: availability.pending.checkoutUrl, expires_at: availability.pending.expiresAt }
        : null,
    });
  } catch (error) {
    return errorResponse(error, 'opportunities/stealth-lock:get');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Authentication required.' },
        { status: 401 }
      );
    }
    // 买断会写库并创建一笔真实的收款，所以按**写**的 scope 要求，而不是读。
    const scopeError = requireScope(auth, 'opportunities:write');
    if (scopeError) return scopeError;

    const body = await request.json().catch(() => ({}));
    parseInput(stealthLockPurchaseSchema, body);

    const { id } = await params;
    const origin = request.nextUrl.origin;
    const result = await StealthLockService.startPurchase(
      auth.user.id,
      id,
      `${origin}/opportunities/${encodeURIComponent(id)}`
    );

    return NextResponse.json(
      {
        lock_id: result.lockId,
        checkout_url: result.checkoutUrl,
        amount_usd: result.amountUsd,
        expires_at: result.expiresAt,
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error, 'opportunities/stealth-lock:post');
  }
}
