import { NextRequest, NextResponse } from 'next/server';
import { LiveScanService, EntitlementService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser, requireScope } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Authentication required to scan opportunities.' },
        { status: 401 }
      );
    }
    const scopeError = requireScope(auth, 'opportunities:write');
    if (scopeError) return scopeError;
    const body = await request.json().catch(() => ({}));
    const { query, marketCountry, language, archetype } = body;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Validation Error',
          status: 400,
          detail: 'Query must be at least 2 characters long.',
        },
        { status: 400 }
      );
    }

    // Reserve live scan daily quota (Free: 3/day, Pro: 30/day, Team: 100/day)
    const scanQuota = await EntitlementService.reserveLiveScanQuota(auth.user.id);

    const result = await LiveScanService.scan({
      query: query.trim(),
      userId: auth.user.id,
      marketCountry: marketCountry || 'US',
      language: language || 'en-US',
      preferredArchetype: archetype,
    });

    return NextResponse.json({
      opportunity: result,
      quota: {
        remainingToday: scanQuota.remaining,
        dailyLimit: scanQuota.limit,
      },
      message: result.isNew
        ? 'Tracking started. The first observation is WATCH with insufficient evidence, not a build decision.'
        : 'This query is already on file.',
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Scan Error',
        status: error.status || 500,
        detail: error.message || 'An error occurred during real-time scan.',
      },
      { status: error.status || 500 }
    );
  }
}
