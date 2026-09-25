import { NextRequest, NextResponse } from 'next/server';
import { LiveScanService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
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

    const result = await LiveScanService.scan({
      query: query.trim(),
      userId: auth?.user.id,
      marketCountry: marketCountry || 'US',
      language: language || 'en-US',
      preferredArchetype: archetype,
    });

    return NextResponse.json({
      opportunity: result,
      message: result.isNew
        ? 'Live search opportunity scanned and cataloged successfully.'
        : 'Retrieved verified opportunity from radar catalog.',
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
