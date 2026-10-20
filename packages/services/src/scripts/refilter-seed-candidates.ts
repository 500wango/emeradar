/**
 * 旧候选回筛（CLI 入口）。
 *
 * 逻辑在 `seed-candidate-cleanup.service`，Admin 面板用的是同一份实现——
 * 两处不能各写一套，否则“脚本清掉的”和“面板看到的”会不一致。
 *
 *   tsx src/scripts/refilter-seed-candidates.ts            # dry run
 *   tsx src/scripts/refilter-seed-candidates.ts --apply    # 归档
 */
import { applySeedCandidateCleanup, scanSeedCandidates } from '../seed-candidate-cleanup.service';

async function main() {
  const apply = process.argv.includes('--apply');
  const report = await scanSeedCandidates();

  console.log(`[refilter] scanned=${report.scanned} rejected=${report.rejected.length} apply=${apply}`);
  for (const row of report.rejected.slice(0, 40)) {
    console.log(`  - ${row.title}  [${row.reason}]  volume=${row.searchVolume ?? '—'}`);
  }
  if (report.rejected.length > 40) console.log(`  ... and ${report.rejected.length - 40} more`);

  if (!apply) {
    console.log('[refilter] dry run — re-run with --apply to archive these.');
    return;
  }
  const archived = await applySeedCandidateCleanup(report, null);
  console.log(`[refilter] archived ${archived}`);
}

main().catch((error) => {
  console.error('[refilter] failed:', error);
  process.exitCode = 1;
});
