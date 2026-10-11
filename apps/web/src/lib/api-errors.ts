import { NextResponse } from 'next/server';
import { AppError } from '@emeradar/core';

/**
 * Single translation point from thrown errors to HTTP responses.
 *
 * Only errors we raise deliberately (`AppError` and anything carrying a 4xx
 * status) surface their message. Everything else is an internal fault: the
 * caller gets a fixed sentence and the detail stays in the server log, so a
 * driver or SQL message can never leak through the API.
 */
export function errorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(error.toRFC9457(), { status: error.status });
  }

  // Anything deliberate carries an AppError shape and was handled above, so a
  // bare 4xx status here comes from a third-party error. Honour the status but
  // not its message: the point of this module is that no internal string
  // reaches the client.
  const status = (error as { status?: number })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return NextResponse.json({ error: 'Request could not be processed.', status }, { status });
  }

  console.error(`[${context}]`, error);
  return NextResponse.json({ error: 'Internal server error', status: 500 }, { status: 500 });
}

/**
 * RFC 9457 variant of {@link errorResponse} for the routes that speak
 * `application/problem+json`. Deliberate errors keep their own detail; anything
 * else becomes an opaque 500 with the real cause written to the server log.
 */
export function internalErrorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(error.toRFC9457(), { status: error.status });
  }

  console.error(`[${context}]`, error);
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
