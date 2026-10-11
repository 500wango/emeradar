import { describe, it, expect } from 'vitest';
import { isPrivateAddress, readBodyWithLimit } from '../src/net';

describe('isPrivateAddress (SSRF guard)', () => {
  const blocked = [
    // IPv4 loopback / private / link-local / CGNAT / reserved
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '100.64.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    // IPv6 loopback / unique-local / link-local / multicast
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '2001:db8::1',
    // IPv4 embedded in IPv6 — the forms a prefix check misses
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::a9fe:a9fe',
    '0:0:0:0:0:ffff:7f00:1',
    '::ffff:7f00:1',
    '64:ff9b::a9fe:a9fe', // NAT64
    '2002:a9fe:a9fe::1', // 6to4
    // unparseable input fails closed
    '',
    'not-an-ip',
    '999.1.1.1',
    '1.2.3',
    '1.2.3.4.5',
    'gggg::1',
  ];

  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '11.0.0.1',
    '172.32.0.1',
    '169.255.0.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ];

  it.each(blocked)('rejects %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(allowed)('accepts %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('readBodyWithLimit', () => {
  it('reads a body under the limit', async () => {
    const res = new Response('hello');
    await expect(readBodyWithLimit(res, 1024)).resolves.toBe('hello');
  });

  it('rejects a declared oversized body', async () => {
    const res = new Response('hello', { headers: { 'content-length': '999999' } });
    await expect(readBodyWithLimit(res, 10)).rejects.toThrow(/exceeds/);
  });

  it('stops a streamed body that exceeds the limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    const res = new Response(stream);
    await expect(readBodyWithLimit(res, 10)).rejects.toThrow(/exceeds/);
  });
});
