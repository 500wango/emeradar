import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@emeradar/services';
import { AppError } from '@emeradar/core';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  let user;
  try {
    user = await AuthService.verifyEmail(token);
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return NextResponse.json({ type: 'about:blank', title: 'Email Verification Error', status: 400, detail: 'This email verification link is invalid or expired.' }, { status: 400 });
  }
  if (!user) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Invalid Verification Link', code: 'EMAIL_VERIFICATION_INVALID', status: 400, detail: 'This email verification link is invalid or expired.' },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, user });
}
