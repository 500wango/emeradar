import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sendTransactionalEmail } from '@/lib/email-delivery';

export async function POST(request: NextRequest) {
  const limit = await checkRateLimit({
    key: `password_reset_ip_${getClientIp(request)}`,
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.success) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Too Many Requests', status: 429, detail: 'Too many password reset requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || !email.includes('@')) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Invalid Email', status: 400, detail: 'A valid email address is required.' },
      { status: 400 }
    );
  }

  const reset = await AuthService.requestPasswordReset(email);
  if (reset) {
    const origin = process.env.APP_ORIGIN || request.nextUrl.origin;
    await sendTransactionalEmail({
      to: reset.email,
      subject: 'Reset your Emeradar password',
      text: `Use this one-time link to reset your password (expires in 30 minutes): ${origin}/reset-password?token=${encodeURIComponent(reset.token)}`,
    });
  }

  // Keep the response identical for known and unknown addresses.
  return NextResponse.json({ ok: true, message: 'If an active account matches that email, a reset link has been sent.' });
}
