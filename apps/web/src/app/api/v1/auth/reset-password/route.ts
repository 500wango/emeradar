import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const limit = await checkRateLimit({
    key: `password_reset_complete_ip_${getClientIp(request)}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.success) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Too Many Requests', status: 429, detail: 'Too many password reset attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    await AuthService.resetPasswordWithToken(token, password);
    return NextResponse.json({ ok: true, message: 'Password reset successfully.' });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return NextResponse.json(
      { type: 'about:blank', title: 'Password Reset Error', status: 400, detail: 'This password reset link is invalid or expired.' },
      { status: 400 }
    );
  }
}
