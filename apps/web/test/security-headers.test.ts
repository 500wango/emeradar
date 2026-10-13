import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';

test('each response has a fresh restrictive CSP matching the rendering request', () => {
  const first = middleware(new NextRequest('https://emeradar.com/login'));
  const second = middleware(new NextRequest('https://emeradar.com/login'));
  const csp = first.headers.get('content-security-policy');
  assert.ok(csp);
  const nonce = csp.match(/script-src [^;]*'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.match(csp, /script-src [^;]*'strict-dynamic'/);
  assert.doesNotMatch(csp, /script-src [^;]*'unsafe-inline'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.equal(first.headers.get('x-middleware-request-x-nonce'), nonce);
  assert.equal(first.headers.get('x-middleware-request-content-security-policy'), csp);
  assert.notEqual(second.headers.get('content-security-policy'), csp);
});

test('production allows React style attributes but not untrusted script execution', () => {
  const policy = middleware(new NextRequest('https://emeradar.com/')).headers.get('content-security-policy')!;
  assert.match(policy, /style-src-attr 'unsafe-inline'/);
  assert.doesNotMatch(policy, /'unsafe-eval'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
});

test('client supplied nonce and CSP are replaced, even on prefetch requests', () => {
  const response = middleware(new NextRequest('https://emeradar.com/login', {
    headers: { 'x-nonce': 'attacker', 'content-security-policy': "script-src *", 'purpose': 'prefetch' },
  }));
  assert.notEqual(response.headers.get('x-middleware-request-x-nonce'), 'attacker');
  assert.equal(response.headers.get('content-security-policy'), response.headers.get('x-middleware-request-content-security-policy'));
});
