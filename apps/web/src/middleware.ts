import { NextRequest, NextResponse } from 'next/server';
import { isPrivatePath } from '@/lib/seo/site';

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
  // 私有与工具页面（登录态工作台、账号/支付流程）明确声明 noindex：匿名爬虫虽然会
  // 被跳到登录页，但把薄薄的表单页收进索引只会有坏处，而且这是唯一一处能覆盖
  // "所有页面 + 重定向响应"的地方。清单与规则见 lib/seo/site.ts。
  if (isPrivatePath(request.nextUrl.pathname)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
}

export const config = {
  // Do not trust client prefetch headers to exempt HTML from CSP.
  matcher: ['/((?!api/|_next/static/|_next/image|favicon.ico).*)'],
};
