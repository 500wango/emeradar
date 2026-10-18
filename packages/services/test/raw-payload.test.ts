import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * R2 原始载荷归档（04 §3）。
 *
 * 未配置 R2 时必须返回 null，不伪造 storage_url；配置后写 raw_payloads 并
 * 把 gzip 内容 PUT 到 S3 兼容端点（这里 mock 掉网络，只验证契约）。
 */
const harness = makeDisposableDb('emeradar_raw_payload_test');
const originalFetch = globalThis.fetch;

async function seedRun(id: string) {
  await harness.db.query(
    `INSERT INTO collector_runs (id, source_id, status) VALUES ($1, 'src_serp', 'SUCCESS')`,
    [id]
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await seedRun('run_raw_test');
});

after(async () => {
  await harness.teardown();
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT']) {
    delete process.env[key];
  }
});

describe('R2 原始载荷归档', () => {
  it('未配置 R2 时返回 null，不写一行假记录', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { storeRawPayload } = harness.services;
    const stored = await storeRawPayload({
      collectorRunId: 'run_raw_test',
      obsDate: '2026-10-18',
      content: '{"hello":"world"}',
      mimeType: 'application/json',
    });
    assert.strictEqual(stored, null);
    assert.strictEqual(
      (await harness.db.query('SELECT COUNT(*)::int AS n FROM raw_payloads')).rows[0].n,
      0
    );
  });

  it('配置后 PUT gzip 并写 raw_payloads + content_hash', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'bucket';
    let putUrl = '';
    let putBody: any;
    globalThis.fetch = (async (url: any, init: any) => {
      putUrl = typeof url === 'string' ? url : String(url?.url ?? url);
      putBody = init?.body ?? (url as any)?.body;
      return new Response('', { status: 200 });
    }) as any;

    const { storeRawPayload } = harness.services;
    const stored = await storeRawPayload({
      collectorRunId: 'run_raw_test',
      obsDate: '2026-10-18',
      content: '{"hello":"world"}',
      mimeType: 'application/json',
    });
    assert.ok(stored);
    assert.match(putUrl, /^https:\/\/acct\.r2\.cloudflarestorage\.com\/bucket\/raw\/2026-10-18\//);
    assert.ok(putBody !== undefined, 'PUT 没有携带 gzip body');

    const row = (
      await harness.db.query<any>(
        `SELECT collector_run_id, storage_url, content_hash FROM raw_payloads WHERE id = $1`,
        [stored!.id]
      )
    ).rows[0];
    assert.strictEqual(row.collector_run_id, 'run_raw_test');
    assert.strictEqual(row.content_hash, stored!.contentHash);
    assert.match(row.storage_url, /^r2:\/\/bucket\/raw\/2026-10-18\//);
  });
});
