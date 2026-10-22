/**
 * 质检样本导出（CLI，只读）。
 *
 * 审计工作单第 2 条：导出近期真实候选的裁决、轴分、来源与采集状态，
 * 预填 QC CSV 的客观列，`label_*` 与 `bad_reason` 留给人工。样本按
 * 裁决分层（BUILD_NOW / EARLY_BET / WATCH / PASS 都要有），导出**不写库**。
 *
 *   tsx src/scripts/export-quality-sample.ts --limit 50 --out /tmp/qc-sample.csv
 */
import { query } from '@emeradar/db';
import { toQcCsv, QC_CSV_HEADER, type QcCsvRow } from '../quality-audit';

interface SampleRow {
  opportunity_id: string;
  slug: string;
  primary_query: string;
  verdict: string;
  d_band: string;
  m_band: string;
  w_band: string;
  confidence: string;
  discovery_source: string | null;
  first_observed_at: string;
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number.parseInt(process.argv[limitArg + 1], 10) || 50 : 50;
  const outArg = process.argv.indexOf('--out');
  const outPath = outArg >= 0 ? process.argv[outArg + 1] : undefined;

  // 按裁决分层：每层轮流取样，直到取满 limit。任何一个裁决层都不该被
  // 高频层淹没，否则人工标注只会看到一种结论的样本。
  const layers = ['BUILD_NOW', 'EARLY_BET', 'WATCH', 'WINDOW_CLOSING', 'PASS'];
  const perLayer = Math.max(1, Math.ceil(limit / layers.length));
  const rows: SampleRow[] = [];
  for (const verdict of layers) {
    const res = await query<SampleRow>(
      `SELECT c.opportunity_id, c.slug, c.primary_query, c.verdict,
              c.d_band, c.m_band, c.w_band, c.confidence,
              o.discovery_source,
              to_char(c.first_observed_at, 'YYYY-MM-DD') AS first_observed_at
       FROM opportunity_cards c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE o.status = 'TRACKED' AND COALESCE(o.is_demo, false) = false
         AND c.verdict = $1
       ORDER BY c.first_observed_at DESC
       LIMIT $2`,
      [verdict, perLayer]
    );
    rows.push(...res.rows);
  }
  const trimmed = rows.slice(0, limit);

  const csvRows: Array<Partial<QcCsvRow>> = trimmed.map((row) => ({ ...row }));
  const csv = toQcCsv(csvRows);

  if (outPath) {
    const fs = await import('node:fs');
    fs.writeFileSync(outPath, csv + '\n');
    console.log(`[qc-export] ${trimmed.length} rows -> ${outPath}`);
  } else {
    process.stdout.write(csv + '\n');
  }

  const header = QC_CSV_HEADER.filter((col) => col.startsWith('label_') || col === 'bad_reason');
  console.error(`[qc-export] 人工填写列：${header.join(', ')}`);
  console.error('[qc-export] 只读导出：本脚本不写任何表。');
}

main().catch((error) => {
  console.error('[qc-export] failed:', error);
  process.exit(1);
});
