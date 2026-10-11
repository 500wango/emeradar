import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { getAuthUser } from '@/lib/auth-server';
import { AppError, parseInput, preferencesSchema } from '@emeradar/core';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'Authentication required to access preferences.',
        },
        { status: 401 }
      );
    }
    if (auth.authMethod === 'api_key') {
      return NextResponse.json({ type: 'about:blank', title: 'Session Required', status: 403, detail: 'Preferences require an interactive user session.' }, { status: 403 });
    }

    return NextResponse.json({ preferences: auth.preferences });
  } catch (error) {
    console.error('[user/preferences] Error:', error);
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Preferences Fetch Error',
        status: 500,
        detail: 'Preferences could not be loaded.',
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'Authentication required to update preferences.',
        },
        { status: 401 }
      );
    }
    if (auth.authMethod === 'api_key') {
      return NextResponse.json({ type: 'about:blank', title: 'Session Required', status: 403, detail: 'Preferences require an interactive user session.' }, { status: 403 });
    }

    const body = parseInput(preferencesSchema, await request.json().catch(() => ({})));
    // Forward only the keys the caller actually sent; `undefined` means "leave
    // unchanged" rather than "reset to default".
    const patch: Record<string, unknown> = {};
    if (body.uiLocale !== undefined) patch.uiLocale = body.uiLocale;
    if (body.preferredMarkets !== undefined) patch.preferredMarkets = body.preferredMarkets;
    if (body.preferredBuildTypes !== undefined) patch.preferredBuildTypes = body.preferredBuildTypes;
    if (body.preferredTimeBudget !== undefined) patch.preferredTimeBudget = body.preferredTimeBudget;
    if (body.topics !== undefined) patch.topics = body.topics;
    if (body.onboardingCompleted !== undefined) patch.onboardingCompleted = body.onboardingCompleted;

    const updated = await AuthService.updatePreferences(auth.user.id, patch);

    return NextResponse.json({
      preferences: updated,
      message: 'Preferences updated successfully.',
    });
  } catch (error) {
    // A rejected body is the caller's problem (400), not a server fault; only
    // anything else is worth a 5xx and a log line.
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    console.error('[user/preferences] Error:', error);
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Preferences Update Error',
        status: 500,
        detail: 'Preferences could not be saved.',
      },
      { status: 500 }
    );
  }
}
