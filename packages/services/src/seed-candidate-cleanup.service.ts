import { query } from '@emeradar/db';
import { AuditService } from './audit.service';
import { CARRIER_NOUNS, isCandidateKeyword } from './pipeline/seed-keyword-candidates';

/**
 * 旧种子候选回筛。
 *
 * 入口规则改过两次（阈值、载体×动词），但迁移不会自动套用新规则——库里因此留着
 * 旧规则放进来的候选：裸词（`checker`，90K/月 是把 chess/color/grammar checker
 * 全加起来的结果）、物理产品（`electric generator`）、关键词工具拼出来的词
 * （`time tracker & ...`）。它们继续占着候选配额、消耗观测预算。
 *
 * 只处理 `discovery_source='KEYWORD_SEED'` 的 CANDIDATE；`LIVE_SCAN` 是用户
 * 自己扫的词，不碰。只改 status，不删任何数据。
 */
export const CLEANUP_RULE_VERSION = 'cleanup-v1';

export interface RejectedCandidate {
  id: string;
  title: string;
  reason: string;
  searchVolume: number | null;
}

export interface CleanupReport {
  scanned: number;
  rejected: RejectedCandidate[];
}

function wordMatch(term: string): RegExp {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

/** 找出不再符合当前入口规则的品种候选（只读）。 */
export async function scanSeedCandidates(): Promise<CleanupReport> {
  const rows = await query<{
    id: string;
    title: string;
    entry_search_volume: number | null;
  }>(
    `SELECT id, title, entry_search_volume
       FROM opportunities
      WHERE status = 'CANDIDATE'
        AND discovery_source = 'KEYWORD_SEED'
      ORDER BY entry_search_volume DESC NULLS LAST`
  );

  const carriers = CARRIER_NOUNS.map((row) => row.carrier);
  const rejected: RejectedCandidate[] = [];

  for (const row of rows.rows) {
    const keyword = row.title.toLowerCase().trim();
    const push = (reason: string) =>
      rejected.push({ id: row.id, title: row.title, reason, searchVolume: row.entry_search_volume });

    // 单 token：入口要求“载体 + 工具动词”至少两段。
    if (keyword.split(/\s+/).length < 2) {
      push('bare single-word query');
      continue;
    }
    if (/[&/+.,]/.test(keyword)) {
      push('punctuation-spliced keyword');
      continue;
    }
    const carrier = carriers.find((candidate) => wordMatch(candidate).test(keyword));
    if (!carrier) {
      push('no known carrier noun');
      continue;
    }
    const passes = isCandidateKeyword(
      {
        keyword: row.title,
        searchVolume: row.entry_search_volume ?? 0,
        keywordDifficulty: null,
        mainIntent: null,
      },
      carrier
    );
    if (!passes) push(`fails carrier/modifier rule (${carrier})`);
  }

  return { scanned: rows.rows.length, rejected };
}

/** 归档（只改 status）。返回实际归档条数。 */
export async function applySeedCandidateCleanup(
  report: CleanupReport,
  actorId: string | null = null
): Promise<number> {
  let archived = 0;
  for (const row of report.rejected) {
    const res = await query(
      `UPDATE opportunities SET status = 'ARCHIVED', updated_at = NOW()
        WHERE id = $1 AND status = 'CANDIDATE'`,
      [row.id]
    );
    archived += res.rowCount ?? 0;
  }

  await AuditService.log({
    actorId,
    actorType: actorId ? 'ADMIN' : 'SYSTEM',
    action: 'candidate.cleanup',
    targetType: 'OPPORTUNITY',
    targetId: 'keyword_seed',
    payload: {
      ruleVersion: CLEANUP_RULE_VERSION,
      scanned: report.scanned,
      archived,
      sample: report.rejected.slice(0, 50).map((row) => ({ title: row.title, reason: row.reason })),
    },
  });

  return archived;
}
