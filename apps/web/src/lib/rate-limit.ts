import { NextRequest } from 'next/server';
import { query, transaction } from '@emeradar/db';

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

interface BucketRow {
  count: number;
  reset_at: Date;
}

/** Runs occasionally to stop rate_limit_buckets from growing without bound. */
async function pruneExpiredBuckets(): Promise<void> {
  try {
    await query(`DELETE FROM rate_limit_buckets WHERE reset_at < NOW() - INTERVAL '1 day'`);
  } catch {
    // Maintenance only: never fail a request because pruning failed.
  }
}

/**
 * Atomically consumes one unit from a fixed-window bucket.
 *
 * A single INSERT ... ON CONFLICT statement performs the increment, so
 * concurrent first hits cannot each read "no row" and reset the window.
 */
export async function checkRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, windowMs } = options;
  const now = Date.now();
  const resetAt = now + windowMs;

  if (Math.random() < 0.01) {
    void pruneExpiredBuckets();
  }

  // The transaction wrapper keeps the statement atomic across poolers.
  return transaction(async (client) => {
    const res = await client.query<BucketRow>(
      `INSERT INTO rate_limit_buckets (bucket_key, count, reset_at)
       VALUES ($1, 1, to_timestamp($2 / 1000.0))
       ON CONFLICT (bucket_key) DO UPDATE SET
         count = CASE
           WHEN rate_limit_buckets.reset_at > NOW() THEN rate_limit_buckets.count + 1
           ELSE 1
         END,
         reset_at = CASE
           WHEN rate_limit_buckets.reset_at > NOW() THEN rate_limit_buckets.reset_at
           ELSE to_timestamp($2 / 1000.0)
         END
       RETURNING count, reset_at`,
      [key, resetAt]
    );
    const row = res.rows[0];
    const effectiveResetAt = row.reset_at.getTime();
    return {
      success: row.count <= limit,
      limit,
      remaining: Math.max(0, limit - row.count),
      resetAt: effectiveResetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((effectiveResetAt - now) / 1000)),
    };
  });
}

/**
 * Reads a bucket without consuming from it. Used for "failed attempts only"
 * limits, so a successful login does not count against the account.
 */
export async function peekRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, windowMs } = options;
  const now = Date.now();
  const res = await query<BucketRow>(
    `SELECT count, reset_at FROM rate_limit_buckets WHERE bucket_key = $1`,
    [key]
  );
  const row = res.rows[0];
  if (!row || row.reset_at.getTime() <= now) {
    return {
      success: true,
      limit,
      remaining: limit,
      resetAt: now + windowMs,
      retryAfterSeconds: 0,
    };
  }
  const resetAt = row.reset_at.getTime();
  return {
    success: row.count < limit,
    limit,
    remaining: Math.max(0, limit - row.count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

/** Clears a bucket, e.g. after a successful login so failures start fresh. */
export async function resetRateLimit(key: string): Promise<void> {
  await query(`DELETE FROM rate_limit_buckets WHERE bucket_key = $1`, [key]);
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // The last hop is the address appended by the trusted reverse proxy; the
    // first hop is client-controlled and must not be used for throttling.
    const last = forwarded.split(',').pop()!.trim();
    if (last) return last;
  }
  // X-Real-IP is only consulted when no XFF is present (the bundled Caddy config
  // strips client-supplied X-Real-IP). Never prefer it over XFF.
  const realIp = request.headers.get('x-real-ip');
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }
  return 'unknown';
}
