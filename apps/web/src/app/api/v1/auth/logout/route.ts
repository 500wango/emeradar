import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get('emeradar_session')?.value;
    if (sessionToken) {
      await AuthService.logout(sessionToken);
    }

    const response = NextResponse.json({
      ok: true,
      message: 'Logged out successfully.',
    });

    response.cookies.set('emeradar_session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch (error: any) {
    const response = NextResponse.json({
      ok: true,
      message: 'Logged out.',
    });
    response.cookies.set('emeradar_session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  }
}
