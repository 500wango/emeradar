import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Phase 0 数据契约：原始载荷字段、提取器版本、拒绝分类。
 *
 * 这些是“可重算”的前提；缺任何一项，历史裁决都无法回答是谁、用什么参数、
 * 哪一版规则算出来的。
 */
const harness = makeDisposableDb('emeradar_data_contract_test');
const OPP = 'opp_contract_test';

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const { query } = harness.db;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, 'contract-test', 'Contract Test', 'TRACKED', CURRENT_DATE)`,
    [OPP]
  );
  await query(
    `INSERT INTO collector_runs (id, source_id, status) VALUES ('run_contract', 'src_serp', 'SUCCESS')`
  );
});

after(async () => {
  await harness.teardown();
});

describe('Phase 0 数据契约', () => {
  it('raw_payloads 记录 provider / 请求参数 / HTTP 状态 / locale', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO raw_payloads
         (id, collector_run_id, source_id, provider, storage_url, content_hash,
          request_params, http_status, locale, mime_type, byte_size)
       VALUES ('11111111-1111-1111-1111-111111111111','run_contract','src_serp','SERPAPI',
               'r2://b/k', repeat('a',64),
               '{"query":"cron monitor","depth":10}'::jsonb, 200, 'en-US', 'application/json', 1234)`
    );
    const row = (
      await query<any>(`SELECT * FROM raw_payloads WHERE id = '11111111-1111-1111-1111-111111111111'`)
    ).rows[0];
    assert.strictEqual(row.provider, 'SERPAPI');
    assert.strictEqual(row.http_status, 200);
    assert.strictEqual(row.request_params.query, 'cron monitor');
    assert.strictEqual(row.byte_size, 1234);
  });

  it('evidence 可以指回原始载荷并带 extractor_version', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { query } = harness.db;
    await query(
      `INSERT INTO evidence
         (opportunity_id, evidence_class, source_type, title, snippet, payload,
          raw_payload_id, extractor_version)
       VALUES ($1,'OBSERVED','PAID_TIER_OBSERVED','Priced','snippet','{}',
               '11111111-1111-1111-1111-111111111111','crawl-1.2.0')`,
      [OPP]
    );
    const row = (await query<any>(`SELECT * FROM evidence WHERE opportunity_id = $1`, [OPP])).rows[0];
    assert.strictEqual(row.extractor_version, 'crawl-1.2.0');
    assert.ok(row.raw_payload_id);
  });

  it('拒绝分类幂等，且可按原因聚合', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { recordRejections, rejectionSummary } = harness.services;
    await recordRejections([
      {
        opportunityId: OPP,
        obsDate: '2026-10-19',
        axis: 'M',
        reasonCode: 'M_INFRA_ONLY',
        evidence: { pricedDomains: 0 },
        ruleVersion: 'sc-1.3.0',
      },
    ]);
    await recordRejections([
      {
        opportunityId: OPP,
        obsDate: '2026-10-19',
        axis: 'M',
        reasonCode: 'M_INFRA_ONLY',
        evidence: { pricedDomains: 0 },
        ruleVersion: 'sc-1.3.0',
      },
    ]);
    const summary = await rejectionSummary('2026-10-19');
    assert.strictEqual(summary.length, 1);
    assert.strictEqual(summary[0].reasonCode, 'M_INFRA_ONLY');
    assert.strictEqual(summary[0].count, 1);
  });

  it('flags 能映射成拒绝原因，未知 flag 不猜', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { rejectionsFromFlags } = harness.services;
    const rows = rejectionsFromFlags(OPP, '2026-10-19', ['BASELINE_PERIOD', 'M_INSUFFICIENT', 'NOPE'], 'sc-1.3.0');
    assert.deepStrictEqual(
      rows.map((r: any) => r.reasonCode).sort(),
      ['DATA_BASELINE_PERIOD', 'M_INSUFFICIENT']
    );
  });
});
