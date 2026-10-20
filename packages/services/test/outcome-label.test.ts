import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { makeDisposableDb } from './helpers/disposable-db';

/**
 * Phase 3 分层标签：代理标签不是 ground truth；数据缺失必须是 NO_LABEL，
 * 不能混成负样本，否则回测会把“被 WAF 拦住”算成“判对了”。
 */
const harness = makeDisposableDb('emeradar_outcome_label_test');

/** 用数据库的今天：窗口判据以 CURRENT_DATE 为基准，硬编码日期会隔天失效。 */
let TODAY = '';

async function seedOpportunity(id: string, options: { observationDays?: number; pricedDomains?: number; verdict?: string } = {}) {
  const { query } = harness.db;
  await query(
    `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
     VALUES ($1, $2, $3, 'TRACKED', CURRENT_DATE)`,
    [id, id.replace(/_/g, '-'), id]
  );
  await query(
    `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier)
     VALUES ($1, $2, 'US', 'en-US', CURRENT_DATE, 'A')`,
    [`qry_${id}`, id]
  );
  await query(
    `INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ($1, $2, 'PRIMARY')`,
    [id, `qry_${id}`]
  );
  await query(
    `INSERT INTO opportunity_cards (opportunity_id, slug, primary_query, verdict, lifecycle,
       d_basis_points, m_basis_points, w_basis_points, d_band, m_band, w_band, confidence,
       recommended_archetype, execution_class, why_now_summary, top_idea, first_observed_at)
     VALUES ($1, $2, $3, $4, 'EARLY_WINDOW', 8000, 7000, 8000, 'HIGH', 'HIGH', 'HIGH',
       'HIGH', 'TOOL', 'S', 'w', 't', NOW())`,
    [id, id.replace(/_/g, '-'), id, options.verdict ?? 'WATCH']
  );
  for (let i = 0; i < (options.observationDays ?? 0); i++) {
    await query(
      `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions, depth, provider)
       VALUES ($1, CURRENT_DATE - $2::int, ARRAY['a'], 1, 'AISA_DATAFORSEO')`,
      [`qry_${id}`, i]
    );
  }
  for (let i = 0; i < (options.pricedDomains ?? 0); i++) {
    await query(
      `INSERT INTO evidence (opportunity_id, evidence_class, source_type, domain, title, snippet, payload)
       VALUES ($1,'OBSERVED','PAID_TIER_OBSERVED',$2,'Priced','s','{}')`,
      [id, `priced-${i}.example`]
    );
  }
  await query(
    `INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date, metrics)
     VALUES ($1, $2, CURRENT_DATE, $3)`,
    [`snp_${id}`, id, JSON.stringify({ history_days: options.observationDays ?? 0 })]
  );
}

before(async () => {
  await harness.setup();
  if (!harness.available) return;
  const todayRes = await harness.db.query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  TODAY = todayRes.rows[0].today;
  await seedOpportunity('opp_label_positive', { observationDays: 20, pricedDomains: 2 });
  await seedOpportunity('opp_label_negative', { observationDays: 20, pricedDomains: 0 });
  await seedOpportunity('opp_label_nodata', {});
});

after(async () => {
  await harness.teardown();
});

describe('Phase 3 分层标签', () => {
  it('需求持续 + 供给进入 → MARKET_FORMED_PROXY / POSITIVE（置信度 MEDIUM）', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { deriveProxyLabel } = harness.services;
    const row = await deriveProxyLabel('opp_label_positive', 60, TODAY);
    assert.strictEqual(row.labelType, 'MARKET_FORMED_PROXY');
    assert.strictEqual(row.label, 'POSITIVE');
    assert.strictEqual(row.confidence, 'MEDIUM');
  });

  it('有观测但供给未进入 → NEGATIVE', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const row = await harness.services.deriveProxyLabel('opp_label_negative', 60, TODAY);
    assert.strictEqual(row.label, 'NEGATIVE');
  });

  it('完全没有数据 → NO_LABEL，不是负样本', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const row = await harness.services.deriveProxyLabel('opp_label_nodata', 60, TODAY);
    assert.strictEqual(row.labelType, 'NO_LABEL');
    assert.strictEqual(row.label, 'UNKNOWN');
  });

  it('数据集导出排除 UNKNOWN，并可按人工金标准过滤', async (t) => {
    if (!harness.available) return t.skip(harness.skipReason);
    const { deriveProxyLabel, upsertLabel, labelDataset } = harness.services;
    for (const id of ['opp_label_positive', 'opp_label_negative', 'opp_label_nodata']) {
      await upsertLabel(await deriveProxyLabel(id, 30, TODAY));
    }
    await upsertLabel({
      opportunityId: 'opp_label_positive',
      horizonDays: 30,
      labelType: 'MANUAL_AUDIT',
      label: 'POSITIVE',
      confidence: 'HIGH',
      evidence: { auditedBy: 'test' },
    });

    const all = await labelDataset({ horizonDays: 30 });
    assert.ok(all.every((row) => row.label !== 'UNKNOWN'));
    assert.ok(all.some((row) => row.labelType === 'MARKET_FORMED_PROXY'));

    const manual = await labelDataset({ horizonDays: 30, onlyManualAudit: true });
    assert.strictEqual(manual.length, 1);
    assert.strictEqual(manual[0].opportunityId, 'opp_label_positive');
  });
});
