import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { getAuthUser } from '@/lib/auth-server';

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
  } catch (error: any) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Preferences Fetch Error',
        status: 500,
        detail: error.message,
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

    const body = await request.json();
    const updated = await AuthService.updatePreferences(auth.user.id, {
      uiLocale: body.uiLocale,
      preferredMarkets: body.preferredMarkets,
      preferredBuildTypes: body.preferredBuildTypes,
      preferredTimeBudget: body.preferredTimeBudget,
      topics: body.topics,
      onboardingCompleted: body.onboardingCompleted,
    });

    return NextResponse.json({
      preferences: updated,
      message: 'Preferences updated successfully.',
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Preferences Update Error',
        status: 500,
        detail: error.message,
      },
      { status: 500 }
    );
  }
}
