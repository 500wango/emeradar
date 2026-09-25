import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';

export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get('emeradar_session')?.value;
    if (!sessionToken) {
      return NextResponse.json({ user: null, preferences: null });
    }

    const sessionData = await AuthService.getSessionUser(sessionToken);
    if (!sessionData) {
      const response = NextResponse.json({ user: null, preferences: null });
      response.cookies.set('emeradar_session', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
      return response;
    }

    return NextResponse.json(sessionData);
  } catch (error: any) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Auth Check Error',
        status: 500,
        detail: error.message || 'Internal error checking session.',
      },
      { status: 500 }
    );
  }
}
