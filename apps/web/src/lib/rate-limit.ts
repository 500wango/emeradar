import { NextRequest } from 'next/server';
import { transaction } from '@emeradar/db';

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, windowMs } = options;
  return transaction(async (client) => {
    const now = Date.now();
    const existing = await client.query<{ count: number; reset_at: Date }>(
      `SELECT count, reset_at FROM rate_limit_buckets WHERE bucket_key = $1 FOR UPDATE`, [key]
    );
    const resetAt = existing.rows[0] && existing.rows[0].reset_at.getTime() > now
      ? existing.rows[0].reset_at.getTime()
      : now + windowMs;
    const count = existing.rows[0] && existing.rows[0].reset_at.getTime() > now
      ? existing.rows[0].count + 1
      : 1;
    await client.query(
      `INSERT INTO rate_limit_buckets (bucket_key, count, reset_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))
       ON CONFLICT (bucket_key) DO UPDATE SET count = EXCLUDED.count, reset_at = EXCLUDED.reset_at`,
      [key, count, resetAt]
    );
    return { success: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
  });
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  if (forwarded) {
    // The last hop is the address appended by the trusted reverse proxy; the
    // first hop is client-controlled and must not be used for throttling.
    return forwarded.split(',').pop()!.trim();
  }
  return '127.0.0.1';
}
