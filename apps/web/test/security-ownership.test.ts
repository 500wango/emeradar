import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import nextConfig from '../next.config';

const caddy = readFileSync(new URL('../../../docker/Caddyfile', import.meta.url), 'utf8');
const configuredHeaders = async () => (await nextConfig.headers?.()) ?? [];

test('Caddy owns singleton security headers, and Next does not add copies', async () => {
  const names = [
    'Strict-Transport-Security', 'X-Content-Type-Options',
    'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy',
  ];
  const nextNames = (await configuredHeaders()).flatMap(rule => rule.headers.map(header => header.key.toLowerCase()));
  for (const name of names) {
    assert.match(caddy, new RegExp(`\\b${name}\\b`, 'i'));
    assert.ok(!nextNames.includes(name.toLowerCase()), `${name} must not be added by both Next and Caddy`);
  }
});
