import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { AppError, parseInput, registerSchema } from '@emeradar/core';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sendTransactionalEmail } from '@/lib/email-delivery';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const { email, password, displayName } = parseInput(
      registerSchema,
      await request.json().catch(() => ({}))
    );

    // Strict rate limiting on registration to stop mass script abuse
    const ipLimit = await checkRateLimit({
      key: `register_ip_${ip}`,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });

    if (!ipLimit.success) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Too Many Registrations',
          status: 429,
          detail: 'Too many registration attempts from this network. Please try again later.',
        },
        {
          status: 429,
          headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) },
        }
      );
    }

    // Email shape and password length are enforced by `registerSchema`.
    const { user, sessionToken } = await AuthService.register({
      email,
      password,
      displayName,
    });

    const verification = await AuthService.requestEmailVerification(user.id);
    if (verification) {
      const origin = process.env.APP_ORIGIN || request.nextUrl.origin;
      await sendTransactionalEmail({
        to: verification.email,
        subject: 'Verify your Emeradar email',
        text: `Verify your Emeradar account within 24 hours: ${origin}/verify-email?token=${encodeURIComponent(verification.token)}`,
      });
    }

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
    console.error('[api] Unhandled error:', error);
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Registration Error',
        status: error.status || 500,
        detail: 'An unexpected error occurred during registration.',
      },
      { status: error.status || 500 }
    );
  }
}
