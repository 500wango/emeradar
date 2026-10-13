import { NextRequest, NextResponse } from 'next/server';

const csp = (nonce: string, development: boolean) => [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
  // Dev HMR injects styles without a nonce. Production style elements require one.
  `style-src 'self' ${development ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
  // React uses style attributes for charts and layout; this does not allow scripts.
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${development ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(development ? [] : ['upgrade-insecure-requests']),
].join('; ');

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = csp(nonce, process.env.NODE_ENV === 'development');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  // Do not trust client prefetch headers to exempt HTML from CSP.
  matcher: ['/((?!api/|_next/static/|_next/image|favicon.ico).*)'],
};
