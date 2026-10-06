import { NextRequest } from 'next/server';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Periodic cleanup of expired records every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (record.resetAt <= now) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}

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

export function checkRateLimit(options: RateLimitOptions): RateLimitResult {
  const { key, limit, windowMs } = options;
  const now = Date.now();
  let record = rateLimitStore.get(key);

  if (!record || record.resetAt <= now) {
    record = { count: 1, resetAt: now + windowMs };
    rateLimitStore.set(key, record);
    return {
      success: true,
      limit,
      remaining: limit - 1,
      resetAt: record.resetAt,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  record.count += 1;
  const remaining = Math.max(0, limit - record.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));

  if (record.count > limit) {
    return {
      success: false,
      limit,
      remaining: 0,
      resetAt: record.resetAt,
      retryAfterSeconds,
    };
  }

  return {
    success: true,
    limit,
    remaining,
    resetAt: record.resetAt,
    retryAfterSeconds,
  };
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  return '127.0.0.1';
}
