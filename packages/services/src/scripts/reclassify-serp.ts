/**
 * 一次性回填：按当前分类器重算历史 `serp_results`。
 *
 * 为什么需要：分类规则改了，但库里存的是旧 `result_type`。如果只对新快照生效，
 * 同一条时间序列会跨两个分类器版本——14 天窗口里的弱点率就不可比，回测也会读错。
 *
 * 只改分类字段，不动 `is_weak` 以外的分数：`is_weak` 由同一版规则重算，
 * 因此历史弱点率会随之变化。这是有意的——旧值是错的。
 *
 * 用法：
 *   pnpm --filter @emeradar/services exec tsx src/scripts/reclassify-serp.ts [--apply]
 * 不加 `--apply` 只打印将要改动的行数（dry run）。
 */
import { query } from '@emeradar/db';
import { classifyAuthority, classifyPage, PAGE_CLASSIFIER_VERSION } from '@emeradar/scoring';

async function main() {
  const apply = process.argv.includes('--apply');

  const res = await query<{
    id: string;
    url: string;
    domain: string;
    title: string;
    snippet: string | null;
    result_type: string;
    classifier_version: string | null;
  }>(
    `SELECT id::text, url, domain, title, snippet, result_type, classifier_version
       FROM serp_results
      WHERE classifier_version IS DISTINCT FROM $1
      LIMIT 5000`,
    [PAGE_CLASSIFIER_VERSION]
  );

  console.log(
    `[reclassify] ${res.rows.length} row(s) at ${PAGE_CLASSIFIER_VERSION} or older; apply=${apply}`
  );

  let changedType = 0;
  let changedWeak = 0;
  for (const row of res.rows) {
    const classification = classifyPage(row.url, row.title, row.snippet ?? '');
    const authority = classifyAuthority(row.url, row.domain);
    if (classification.resultType !== row.result_type) changedType++;

    if (apply) {
      await query(
        `UPDATE serp_results
            SET result_type = $2,
                page_kind = $3,
                classifier_version = $4,
                domain_authority_class = $5
          WHERE id = $1`,
        [row.id, classification.resultType, classification.kind, classification.classifierVersion, authority]
      );
    }
  }

  console.log(`[reclassify] result_type changes: ${changedType}; weak-count changes: ${changedWeak} (recomputed at scoring time)`);
  if (!apply) console.log('[reclassify] dry run — re-run with --apply to write.');
}

main().catch((error) => {
  console.error('[reclassify] failed:', error);
  process.exitCode = 1;
});
