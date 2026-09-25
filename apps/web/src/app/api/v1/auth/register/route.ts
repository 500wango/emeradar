import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { AppError } from '@emeradar/core';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, displayName, tier } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Invalid Email',
          status: 400,
          detail: 'A valid email address is required.',
        },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Weak Password',
          status: 400,
          detail: 'Password must be at least 6 characters long.',
        },
        { status: 400 }
      );
    }

    const { user, sessionToken } = await AuthService.register({
      email,
      password,
      displayName: displayName?.trim() || undefined,
      tier: tier === 'TEAM' || tier === 'FREE' ? tier : 'PRO',
    });

    const response = NextResponse.json({
      user,
      message: 'Account registered successfully.',
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
        title: 'Registration Error',
        status: error.status || 500,
        detail: error.message || 'An unexpected error occurred during registration.',
      },
      { status: error.status || 500 }
    );
  }
}
