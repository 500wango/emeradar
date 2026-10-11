import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { AppError, loginSchema, parseInput } from '@emeradar/core';
import { checkRateLimit, getClientIp, peekRateLimit, resetRateLimit } from '@/lib/rate-limit';

const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_MAX_FAILURES = 5;

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const { email, password } = parseInput(loginSchema, await request.json().catch(() => ({})));

    // Coarse per-IP throttle: every attempt counts.
    const ipLimit = await checkRateLimit({
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

    // The schema already trims and lower-cases the email, so the throttle key
    // needs no further normalisation.
    const emailKey = `login_email_${email}`;

    // Per-account throttle counts FAILED attempts only. We peek first so a
    // successful login never consumes the allowance, then increment on failure.
    const emailLimit = await peekRateLimit({
      key: emailKey,
      limit: EMAIL_MAX_FAILURES,
      windowMs: EMAIL_WINDOW_MS,
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

    let sessionToken: string;
    try {
      const { sessionToken: token } = await AuthService.login({ email, password });
      sessionToken = token;
    } catch (err) {
      // Record the failed attempt against the account bucket.
      await checkRateLimit({ key: emailKey, limit: EMAIL_MAX_FAILURES, windowMs: EMAIL_WINDOW_MS });
      throw err;
    }

    // A successful login clears the account's failure history.
    await resetRateLimit(emailKey);

    const response = NextResponse.json({
      user: (await AuthService.getSessionUser(sessionToken))?.user ?? null,
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
    // Anything that is not an AppError is a server fault (database down, bug).
    // Reporting it as 401 would make an outage look like a wrong password and
    // keep it out of the 5xx alerts.
    console.error('[api] Unhandled error:', error);
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected internal error occurred.',
      },
      { status: 500 }
    );
  }
}
