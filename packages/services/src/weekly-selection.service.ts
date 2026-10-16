import { query } from '@emeradar/db';
import { hiddenFromEveryone } from './stealth-lock-policy';
import { loadVerdictRun, windowClosingState } from './publication-policy';

/** 超过这个天数没有新的合格案例，就回退到历史案例并标注（30 Q10）。 */
export const WEEKLY_FRESH_DAYS = 7;

export interface WeeklySelectedCase {
  opportunityId: string;
  slug: string;
  title: string;
  primaryQuery: string;
  verdict: string;
  whyNowSummary: string;
  /** 它因何具备准实时资格（15 §3 第 1 条）。 */
  eligibleReason: 'CROWDED_LOCKED' | 'WINDOW_CLOSING';
  /** 资格成立的时点（ISO）。 */
  eligibleSince: string;
  /** 为真表示 7 天内没有新案例，这是一条历史案例，界面必须标注。 */
  historical: boolean;
}

/**
 * Free 层 `feed_selected_weekly`：每周 1 条刚满额锁定或刚关窗的案例（13 §3.2、15 §3）。
 *
 * 资格只来自两个条件，**绝不放宽**：槽位已满额，或当前处于 `WINDOW_CLOSING`。
 * 仍有空槽的 BUILD_NOW 永远不会被选中，回退也不例外（Q10）。买断保护期内的机会
 * 对所有人隐藏，M 轴 INSUFFICIENT 的不选。
 *
 * 满额时点取 `opportunity_slots.updated_at`（每次认领递增都会刷新它）；关窗时点取
 * 账本里连续 WINDOW_CLOSING 段的起始日。`now` 显式传入，同一输入必得同一结果。
 */
export class WeeklySelectionService {
  static async getWeeklySelectedCase(now: Date = new Date()): Promise<WeeklySelectedCase | null> {
    const fullExpr = `COALESCE((SELECT SUM(s.capacity) > 0 AND SUM(s.claimed) >= SUM(s.capacity)
                                  FROM opportunity_slots s WHERE s.opportunity_id = o.id), false)`;
    const candidates = await query<{
      opportunity_id: string;
      slug: string;
      title: string;
      primary_query: string;
      verdict: string;
      why_now_summary: string;
      slots_full: boolean;
      slots_updated_at: Date | null;
    }>(
      `SELECT c.opportunity_id, c.slug, o.title, c.primary_query, c.verdict, c.why_now_summary,
              ${fullExpr} AS slots_full,
              (SELECT MAX(s.updated_at) FROM opportunity_slots s WHERE s.opportunity_id = o.id) AS slots_updated_at
         FROM opportunity_cards c
         JOIN opportunities o ON o.id = c.opportunity_id
        WHERE o.status = 'TRACKED'
          AND c.m_band <> 'INSUFFICIENT'
          AND ${hiddenFromEveryone('o.id')}
          AND (${fullExpr} OR c.verdict = 'WINDOW_CLOSING')
        LIMIT 200`
    );

    let best: { row: (typeof candidates.rows)[number]; since: number; reason: WeeklySelectedCase['eligibleReason'] } | null = null;

    for (const row of candidates.rows) {
      const options: Array<{ since: number; reason: WeeklySelectedCase['eligibleReason'] }> = [];
      if (row.slots_full && row.slots_updated_at) {
        options.push({ since: row.slots_updated_at.getTime(), reason: 'CROWDED_LOCKED' });
      }
      if (row.verdict === 'WINDOW_CLOSING') {
        const state = windowClosingState(await loadVerdictRun(row.opportunity_id));
        if (state.current && state.enteredOn) {
          const entered = Date.parse(`${state.enteredOn}T00:00:00Z`);
          if (!Number.isNaN(entered)) options.push({ since: entered, reason: 'WINDOW_CLOSING' });
        }
      }
      for (const option of options) {
        if (!best || option.since > best.since) best = { row, ...option };
      }
    }

    if (!best) return null;
    const ageDays = (now.getTime() - best.since) / 86_400_000;
    return {
      opportunityId: best.row.opportunity_id,
      slug: best.row.slug,
      title: best.row.title,
      primaryQuery: best.row.primary_query,
      verdict: best.row.verdict,
      whyNowSummary: best.row.why_now_summary,
      eligibleReason: best.reason,
      eligibleSince: new Date(best.since).toISOString(),
      historical: ageDays > WEEKLY_FRESH_DAYS,
    };
  }
}
