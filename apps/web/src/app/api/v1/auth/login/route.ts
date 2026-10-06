import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const body = await request.json().catch(() => ({}));
    const { email, password } = body;

    // Rate limiting: max 10 requests per minute per IP, max 5 failed attempts per 15 min per account
    const ipLimit = checkRateLimit({
      key: `login_ip_${ip}`,
      limit: 15,
      windowMs: 60 * 1000,
    });

    if (!ipLimit.success) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Too Many Requests',
          status: 429,
          detail: 'Too many login attempts. Please wait before trying again.',
        },
        {
          status: 429,
          headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) },
        }
      );
    }

    if (email && typeof email === 'string') {
      const emailLimit = checkRateLimit({
        key: `login_email_${email.toLowerCase().trim()}`,
        limit: 5,
        windowMs: 15 * 60 * 1000,
      });

      if (!emailLimit.success) {
        return NextResponse.json(
          {
            type: 'about:blank',
            title: 'Account Temporarily Locked',
            status: 429,
            detail: 'Too many consecutive failed login attempts for this account. Please wait 15 minutes before trying again.',
          },
          {
            status: 429,
            headers: { 'Retry-After': String(emailLimit.retryAfterSeconds) },
          }
        );
      }
    }

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
