/**
 * 一次性回填：按当前入口规则重新检查已有的种子候选。
 *
 * 为什么需要：入口规则改过两次（阈值、载体×动词），但库里还留着旧规则放进来的候选，
 * 例如裸词 `checker`——它在旧模型里是“种子”，现在连载体都不是，而且 90K/月
 * 那个数字是把“chess checker / color checker / grammar checker”全部加在一起的结果，
 * 根本不是工具需求。留着它们会继续消耗观测预算，也会污染“候选池质量”的判断。
 *
 * 只归档 `discovery_source='KEYWORD_SEED'` 且不再通过当前入口规则的 CANDIDATE；
 * 用户主动扫描的 LIVE_SCAN 不碰。
 *
 * 用法：
 *   pnpm --filter @emeradar/services exec tsx src/scripts/refilter-seed-candidates.ts
 *   ... --apply   真正写库（默认 dry run）
 */
import { query } from '@emeradar/db';
import {
  CARRIER_NOUNS,
  isCandidateKeyword,
} from '../pipeline/seed-keyword-candidates';

async function main() {
  const apply = process.argv.includes('--apply');

  const candidates = await query<{
    id: string;
    title: string;
    entry_search_volume: number | null;
    candidate_reason: string | null;
  }>(
    `SELECT id, title, entry_search_volume, candidate_reason
       FROM opportunities
      WHERE status = 'CANDIDATE'
        AND discovery_source = 'KEYWORD_SEED'
      ORDER BY entry_search_volume DESC NULLS LAST`
  );

  const carriers = CARRIER_NOUNS.map((row) => row.carrier);
  const rejected: Array<{ id: string; title: string; why: string; volume: number | null }> = [];

  for (const row of candidates.rows) {
    const keyword = row.title.toLowerCase().trim();
    // 裸词（单 token）一律不合格：入口要求“载体 + 工具动词”至少两段。
    if (keyword.split(/\s+/).length < 2) {
      rejected.push({ id: row.id, title: row.title, why: 'bare single-word query', volume: row.entry_search_volume });
      continue;
    }
    // 至少命中一个载体，并且通过当前入口规则。
    const carrier = carriers.find((candidate) => {
      const re = new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return re.test(keyword);
    });
    if (!carrier) {
      rejected.push({ id: row.id, title: row.title, why: 'no known carrier noun', volume: row.entry_search_volume });
      continue;
    }
    const passes = isCandidateKeyword(
      { keyword: row.title, searchVolume: row.entry_search_volume ?? 0, keywordDifficulty: null, mainIntent: null },
      carrier
    );
    if (!passes) {
      rejected.push({ id: row.id, title: row.title, why: `fails carrier/modifier rule (${carrier})`, volume: row.entry_search_volume });
    }
  }

  console.log(`[refilter] candidates=${candidates.rows.length} rejected=${rejected.length} apply=${apply}`);
  for (const row of rejected.slice(0, 40)) {
    console.log(`  - ${row.title}  [${row.why}]  volume=${row.volume ?? '—'}`);
  }
  if (rejected.length > 40) console.log(`  ... and ${rejected.length - 40} more`);

  if (!apply) {
    console.log('[refilter] dry run — re-run with --apply to archive these.');
    return;
  }

  for (const row of rejected) {
    await query(
      `UPDATE opportunities SET status = 'ARCHIVED', updated_at = NOW()
        WHERE id = $1 AND status = 'CANDIDATE'`,
      [row.id]
    );
  }
  console.log(`[refilter] archived ${rejected.length}`);
}

main().catch((error) => {
  console.error('[refilter] failed:', error);
  process.exitCode = 1;
});
