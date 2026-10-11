import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { getAuthUser } from '@/lib/auth-server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sendTransactionalEmail } from '@/lib/email-delivery';
import { AppError } from '@emeradar/core';

export async function POST(request: NextRequest) {
  const auth = await getAuthUser(request);
  if (!auth || auth.authMethod !== 'session') {
    return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'An interactive session is required.' }, { status: 401 });
  }
  const limit = await checkRateLimit({
    key: `email_verification_${auth.user.id}_${getClientIp(request)}`,
    limit: 3,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.success) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Too Many Requests', status: 429, detail: 'Too many verification emails. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const verification = await AuthService.requestEmailVerification(auth.user.id);
    if (verification) {
      const origin = process.env.APP_ORIGIN || request.nextUrl.origin;
      await sendTransactionalEmail({
        to: verification.email,
        subject: 'Verify your Emeradar email',
        text: `Verify your Emeradar account within 24 hours: ${origin}/verify-email?token=${encodeURIComponent(verification.token)}`,
      });
    }
    return NextResponse.json({ ok: true, message: 'If your email is not verified, a new verification link has been sent.' });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return NextResponse.json({ type: 'about:blank', title: 'Verification Email Error', status: 500, detail: 'Could not send a verification email.' }, { status: 500 });
  }
}
