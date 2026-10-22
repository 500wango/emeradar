/**
 * 影子重算（CLI，只读）：用**当前**评分引擎重放历史封存输入，与账本逐字段比对。
 *
 * 审计工作单第 7 条：修复改了公式（sc-1.3.0 → sc-1.4.0），必须先影子对比、
 * 通过后才切生产。与 `RecomputeService` 不同——那一个是同口径自检（跨版本直接
 * 拒绝），这里是**跨口径**的影子对比：差异就是新公式的预期影响清单。
 * **不写任何表、不覆盖 verdict/ledger 历史**；产出 NDJSON 报告供人工审阅。
 *
 *   tsx src/scripts/shadow-rescore.ts --since 2026-09-01 --out /tmp/shadow.ndjson
 */
import { query } from '@emeradar/db';
import { calculateOpportunityScore, FullOpportunityScoreInput, SCORING_CONFIG_VERSION } from '@emeradar/scoring';

interface ShadowReportRow {
  opportunityId: string;
  obsDate: string;
  ledgerVersion: string;
  shadowVersion: string;
  ledger: Record<string, unknown>;
  shadow: Record<string, unknown>;
  diffs: Array<{ field: string; ledger: unknown; shadow: unknown }>;
}

async function main() {
  const sinceArg = process.argv.indexOf('--since');
  const since = sinceArg >= 0 ? process.argv[sinceArg + 1] : undefined;
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number.parseInt(process.argv[limitArg + 1], 10) || 200 : 200;
  const outArg = process.argv.indexOf('--out');
  const outPath = outArg >= 0 ? process.argv[outArg + 1] : undefined;

  const params: unknown[] = [limit];
  let sinceClause = '';
  if (since) {
    sinceClause = 'AND to_char(v.obs_date, \'YYYY-MM-DD\') >= $2';
    params.push(since);
  }

  const rows = await query<{
    opportunity_id: string;
    obs_date: string;
    scoring_config_version: string;
    scoring_input: FullOpportunityScoreInput | null;
    verdict: string;
    raw_verdict: string | null;
    lifecycle: string;
    d_basis_points: number;
    m_basis_points: number;
    w_basis_points: number;
    d_band: string;
    m_band: string;
    w_band: string;
    confidence: string;
  }>(
    `SELECT v.opportunity_id, to_char(v.obs_date, 'YYYY-MM-DD') AS obs_date,
            v.scoring_config_version, s.scoring_input,
            v.verdict, v.raw_verdict, v.lifecycle,
            v.d_basis_points, v.m_basis_points, v.w_basis_points,
            v.d_band, v.m_band, v.w_band, v.confidence
     FROM verdicts v
     JOIN opportunity_snapshots s
       ON s.opportunity_id = v.opportunity_id AND s.obs_date = v.obs_date
     WHERE v.hash_version >= 2 AND s.scoring_input IS NOT NULL ${sinceClause}
     ORDER BY v.obs_date DESC
     LIMIT $1`,
    params
  );

  const report: ShadowReportRow[] = [];
  let withInput = 0;
  for (const row of rows.rows) {
    if (!row.scoring_input) continue;
    withInput++;
    // 影子重算明确跨口径：旧账本值保留原样，新值只存在于报告里。
    const shadow = calculateOpportunityScore(row.scoring_input);
    const ledger: Record<string, unknown> = {
      verdict: row.verdict,
      rawVerdict: row.raw_verdict,
      lifecycle: row.lifecycle,
      dScore: row.d_basis_points,
      mScore: row.m_basis_points,
      wScore: row.w_basis_points,
      dBand: row.d_band,
      mBand: row.m_band,
      wBand: row.w_band,
      confidence: row.confidence,
    };
    const shadowFlat: Record<string, unknown> = {
      verdict: shadow.verdict,
      rawVerdict: shadow.rawVerdict,
      lifecycle: shadow.lifecycle,
      dScore: shadow.dScore,
      mScore: shadow.mScore,
      wScore: shadow.wScore,
      dBand: shadow.dBand,
      mBand: shadow.mBand,
      wBand: shadow.wBand,
      confidence: shadow.confidence,
    };
    const diffs = Object.keys(ledger)
      .filter((field) => ledger[field] !== shadowFlat[field])
      .map((field) => ({ field, ledger: ledger[field], shadow: shadowFlat[field] }));
    report.push({
      opportunityId: row.opportunity_id,
      obsDate: row.obs_date,
      ledgerVersion: row.scoring_config_version,
      shadowVersion: SCORING_CONFIG_VERSION,
      ledger,
      shadow: shadowFlat,
      diffs,
    });
  }

  const changed = report.filter((row) => row.diffs.length > 0);
  const summary = {
    shadowVersion: SCORING_CONFIG_VERSION,
    rows: report.length,
    changedRows: changed.length,
    verdictFlips: changed.filter((row) => row.diffs.some((d) => d.field === 'verdict')).length,
    dBandChanges: changed.filter((row) => row.diffs.some((d) => d.field === 'dBand')).length,
    mBandChanges: changed.filter((row) => row.diffs.some((d) => d.field === 'mBand')).length,
    wBandChanges: changed.filter((row) => row.diffs.some((d) => d.field === 'wBand')).length,
  };

  const ndjson = report.map((row) => JSON.stringify(row)).join('\n');
  if (outPath) {
    const fs = await import('node:fs');
    fs.writeFileSync(outPath, ndjson + (ndjson ? '\n' : ''));
    console.log(`[shadow] ${report.length} rows -> ${outPath}`);
  }
  console.log(`[shadow] summary ${JSON.stringify(summary)}`);
  console.log('[shadow] 只读重放：未写任何表，ledger/verdict 历史未被触碰。');
}

main().catch((error) => {
  console.error('[shadow] failed:', error);
  process.exit(1);
});
