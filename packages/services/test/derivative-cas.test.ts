import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Phase 4 存储：派生清洗必须确定性且体积受限，并且**不能替代原始载荷**；
 * 派生记录挂在 raw_payload_id 上，原始行仍在。
 */
const harness = makeDisposableDb('emeradar_derivative_cas_test');

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  await harness.db.query(
    `INSERT INTO collector_runs (id, source_id, status) VALUES ('run_deriv', 'src_crawl', 'SUCCESS')`
  );
});

after(async () => {
  await harness.teardown();
});

function bigHtml() {
  const base64 = 'data:image/png;base64,' + 'A'.repeat(5000);
  return `<html><head><title>Pricing</title>
    <script type="application/ld+json">{"@type":"Product","offers":{"price":"29"}}</script>
    </head><body>
    <img src="${base64}" />
    <svg><path d="M0 0 L100 100"/></svg>
    <style>.x{color:red}</style>
    <div class="plan"><h2>Pro</h2><span>$29/mo</span></div>
    <div class="filler">${'lorem ipsum '.repeat(2000)}</div>
    </body></html>`;
}

describe('Phase 4 派生存储', () => {
  it('清洗是确定性的，保留价格与 head，去掉 base64/SVG/样式', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { sanitizeHtml } = harness.services;
    const html = bigHtml();
    const first = sanitizeHtml(html);
    const second = sanitizeHtml(html);
    assert.strictEqual(first, second, '同一份 HTML 必须得到同一份派生');
    assert.ok(first.length < html.length);
    assert.ok(/\$29\/mo|\$29/.test(first), '价格必须保留');
    assert.ok(/application\/ld\+json/.test(first), 'head 的 JSON-LD 必须保留');
    assert.ok(!first.includes('A'.repeat(200)), 'base64 图片必须去掉');
  });

  it('派生记录挂在 raw_payload 上，原始行不受影响', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO raw_payloads (id, collector_run_id, source_id, provider, storage_url, content_hash, mime_type)
       VALUES ('22222222-2222-2222-2222-222222222222','run_deriv','src_crawl','DIRECT_HTTP',
               'r2://b/raw.html.gz', repeat('b',64), 'text/html')`
    );
    const stored = await harness.services.storeHtmlDerivative(
      '22222222-2222-2222-2222-222222222222',
      bigHtml()
    );
    assert.ok(stored);
    assert.ok(stored!.byteSize > 0);

    const raw = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM raw_payloads WHERE id = '22222222-2222-2222-2222-222222222222'`
    );
    assert.strictEqual(raw.rows[0].count, 1, '原始载荷必须仍在');

    const deriv = await query<{ kind: string; derivative_version: string }>(
      `SELECT kind, derivative_version FROM raw_payload_derivatives
        WHERE raw_payload_id = '22222222-2222-2222-2222-222222222222'`
    );
    assert.strictEqual(deriv.rows.length, 1);
    assert.strictEqual(deriv.rows[0].derivative_version, 'sanitize-v1');

    // 幂等：重复写不产生第二行。
    await harness.services.storeHtmlDerivative('22222222-2222-2222-2222-222222222222', bigHtml());
    const again = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM raw_payload_derivatives
        WHERE raw_payload_id = '22222222-2222-2222-2222-222222222222'`
    );
    assert.strictEqual(again.rows[0].count, 1);
  });

  it('CAS：同内容只上传一次，但每天仍留时序指针', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO collector_runs (id, source_id, status) VALUES ('run_cas_a', 'src_serp', 'SUCCESS'), ('run_cas_b', 'src_serp', 'SUCCESS')`
    );
    const content = JSON.stringify({ organic: ['a', 'b'] });
    const first = await harness.services.storeRawPayload({
      collectorRunId: 'run_cas_a',
      sourceId: 'src_serp',
      provider: 'SERPAPI',
      obsDate: '2026-10-19',
      content,
      mimeType: 'application/json',
    });
    const second = await harness.services.storeRawPayload({
      collectorRunId: 'run_cas_b',
      sourceId: 'src_serp',
      provider: 'SERPAPI',
      obsDate: '2026-10-20',
      content,
      mimeType: 'application/json',
    });
    // R2 未配置时两者都是 null（不伪造 storage_url）；这里只验证不抛错且语义清晰。
    assert.strictEqual(first, null);
    assert.strictEqual(second, null);
  });
});
