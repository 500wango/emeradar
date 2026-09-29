import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { AppError } from '@emeradar/core';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Missing Email',
          status: 400,
          detail: 'Email address is required.',
        },
        { status: 400 }
      );
    }

    const { user, sessionToken } = await AuthService.login({
      email,
      password,
    });

    const response = NextResponse.json({
      user,
      message: 'Login successful.',
    });

    response.cookies.set('emeradar_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Authentication Error',
        status: error.status || 401,
        detail: error.message || 'Invalid credentials or account inactive.',
      },
      { status: error.status || 401 }
    );
  }
}
