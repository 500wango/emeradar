/**
 * RFC 8785 JSON Canonicalization Scheme (JCS)
 * Deterministic JSON serialization for cryptographic hashing.
 */
export function canonicalizeJson(value: any): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Non-finite numbers cannot be canonicalized in JSON');
    }
    // Formats integer or float deterministically
    return Object.is(value, -0) ? '0' : String(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => {
      const canonical = canonicalizeJson(item);
      return canonical === undefined ? 'null' : canonical;
    });
    return `[${items.join(',')}]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const val = value[key];
      if (val !== undefined && typeof val !== 'symbol' && typeof val !== 'function') {
        const canonicalVal = canonicalizeJson(val);
        if (canonicalVal !== undefined) {
          entries.push(`${JSON.stringify(key)}:${canonicalVal}`);
        }
      }
    }
    return `{${entries.join(',')}}`;
  }

  return undefined as any;
}
