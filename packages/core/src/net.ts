/**
 * Network-address classification shared by every component that fetches a
 * user-supplied URL (SSRF defence).
 *
 * The rules deliberately fail closed: anything that cannot be parsed as an
 * address is reported as non-public, so an exotic literal can never sneak past
 * the guard. IPv4-mapped (`::ffff:`), IPv4-compatible, NAT64 (`64:ff9b::/96`)
 * and 6to4 (`2002::/16`) IPv6 forms are unwrapped before the IPv4 rules run —
 * these are the forms that previously slipped through string-prefix checks.
 */

function parseIpv4Bytes(value: string): Uint8Array | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const part = parts[i];
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

function isPrivateIpv4(b: Uint8Array): boolean {
  const a = b[0];
  const second = b[1];
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 100 && second >= 64 && second <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && second === 254) return true; // link-local / cloud metadata
  if (a === 172 && second >= 16 && second <= 31) return true; // private
  if (a === 192 && second === 168) return true; // private
  if (a === 192 && second === 0 && (b[2] === 0 || b[2] === 2)) return true; // IETF + TEST-NET-1
  if (a === 198 && (second === 18 || second === 19)) return true; // benchmarking
  if (a === 198 && second === 51 && b[2] === 100) return true; // TEST-NET-2
  if (a === 203 && second === 0 && b[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function parseIpv6Bytes(input: string): Uint8Array | null {
  let value = input.toLowerCase();
  const zoneIndex = value.indexOf('%'); // fe80::1%eth0
  if (zoneIndex >= 0) value = value.slice(0, zoneIndex);
  if (!value || !/^[0-9a-f:.]+$/.test(value)) return null;

  const halves = value.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups = segment.split(':');
    const out: number[] = [];
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      if (group.includes('.')) {
        // Dotted-quad tail is only legal as the final group.
        if (i !== groups.length - 1) return null;
        const v4 = parseIpv4Bytes(group);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0]);
  if (!head) return null;

  let groups: number[];
  if (halves.length === 2) {
    const tail = parseGroups(halves[1]);
    if (!tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  groups.forEach((group, i) => {
    bytes[i * 2] = (group >> 8) & 0xff;
    bytes[i * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function isPrivateIpv6(b: Uint8Array): boolean {
  const zeroThrough = (end: number) => b.slice(0, end).every((byte) => byte === 0);

  if (zeroThrough(15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  if (zeroThrough(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIpv4(b.slice(12)); // ::ffff:a.b.c.d
  if (zeroThrough(12)) return isPrivateIpv4(b.slice(12)); // ::a.b.c.d (IPv4-compatible)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((byte) => byte === 0)) {
    return isPrivateIpv4(b.slice(12)); // NAT64 64:ff9b::/96
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIpv4(b.slice(2, 6)); // 6to4 2002::/16
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link local
  if (b[0] === 0xff) return true; // multicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 documentation
  if (b[0] === 0x01 && b[1] === 0x00 && b.slice(2, 8).every((byte) => byte === 0)) return true; // 100::/64 discard-only
  return false;
}

/**
 * True when the literal must not be fetched: private, loopback, link-local,
 * CGNAT, multicast, documentation or otherwise unroutable on the public
 * internet. Unparseable input is treated as unsafe.
 */
export function isPrivateAddress(address: string): boolean {
  const value = String(address ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return true;
  if (value.includes(':')) {
    const bytes = parseIpv6Bytes(value);
    return bytes ? isPrivateIpv6(bytes) : true;
  }
  const bytes = parseIpv4Bytes(value);
  return bytes ? isPrivateIpv4(bytes) : true;
}

/** Maximum number of bytes we will read from a third-party response body. */
export const MAX_FETCH_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Reads a response body, aborting once `maxBytes` have been consumed. Keeps a
 * hostile or merely enormous page from exhausting worker memory.
 */
export async function readBodyWithLimit(
  response: Response,
  maxBytes: number = MAX_FETCH_BODY_BYTES
): Promise<string> {
  const declared = Number(response.headers.get('content-length') || '0');
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Response body exceeds the ${maxBytes} byte limit`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Response body exceeds the ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}
