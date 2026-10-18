import { query } from '@emeradar/db';
import {
  evaluateLostFirstMoverValue,
  loadLostValueFacts,
  loadVerdictRun,
  lostFirstMoverValue,
  startOfLocalDay,
  windowClosingEnteredOn,
  type LostFirstMoverBasis,
  type LostValueFacts,
} from './publication-policy';

/** 超过这个天数没有新的合格案例，就回退到历史案例并标注（30 Q10）。 */
export const WEEKLY_FRESH_DAYS = 7;

const DAY_MS = 86_400_000;
const ELIGIBLE_BASES: readonly LostFirstMoverBasis[] = [
  'WINDOW_CLOSING',
  'PASS',
  'LIFECYCLE_CLOSED',
  'INACTIVE_14D',
];

export interface WeeklySelectedCase {
  opportunityId: string;
  slug: string;
  title: string;
  primaryQuery: string;
  verdict: string;
  whyNowSummary: string;
  /** 它因何「已失去抢跑价值」而具备准实时资格（15 §3 第 1 条、01 §1.8）。 */
  eligibleReason: LostFirstMoverBasis;
  /** 资格成立的时点（ISO）。 */
  eligibleSince: string;
  /** 为真表示 7 天内没有新案例，这是一条历史案例，界面必须标注。 */
  historical: boolean;
}

interface CandidateRow {
  opportunity_id: string;
  slug: string;
  title: string;
  primary_query: string;
  verdict: string;
  why_now_summary: string;
}

function dayMs(date: string | null | undefined): number | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Free 层 `feed_selected_weekly`：每周 1 条**已失去抢跑价值**的案例（13 §3.2、15 §3）。
 *
 * 资格与公开投影**同源**（`evaluateLostFirstMoverValue`）：活跃的 BUILD_NOW /
 * EARLY_BET 永不入选，回退也不例外。v3.1 之前这里看的是"槽位满额或刚关窗"，那两个
 * 判据都已随槽位一起拆除。
 *
 * 选的是**最近失去价值**的那一条。`eligibleSince` 是展示口径：
 *   · `WINDOW_CLOSING` → 当前这段关窗期的第一天（账本连续段）；
 *   · `INACTIVE_14D` → 最后一条活跃裁决之后满 14 天的那天；
 *   · 其余（PASS / 生命周期关闭）→ 最新裁决的观测日。
 *
 * 当周没有新案例（没有合格机会，或最近一条也已超过 7 天）时，回退到**最近一条已公开
 * 案例**并把它的发布日期标注出来。一条都不存在才返回 `null` —— 空列表本身也是信息，
 * 界面不该拿一条编造的案例填坑。
 */
export class WeeklySelectionService {
  static async getWeeklySelectedCase(now: Date = new Date()): Promise<WeeklySelectedCase | null> {
    const candidates = await query<CandidateRow>(
      `SELECT c.opportunity_id, c.slug, o.title, c.primary_query, c.verdict, c.why_now_summary
         FROM opportunity_cards c
         JOIN opportunities o ON o.id = c.opportunity_id
        WHERE o.status = 'TRACKED'
          AND c.m_band <> 'INSUFFICIENT'
        ORDER BY c.first_observed_at DESC
        LIMIT 200`
    );
    const factsById = await loadLostValueFacts(candidates.rows.map((row) => row.opportunity_id));

    let best: { row: CandidateRow; basis: LostFirstMoverBasis; since: number } | null = null;
    for (const row of candidates.rows) {
      const facts = factsById.get(row.opportunity_id);
      if (!facts) continue;
      const judgement = evaluateLostFirstMoverValue(facts, now);
      if (!judgement.eligible || !judgement.basis) continue;

      const since = await WeeklySelectionService.eligibleSince(row, judgement.basis, facts);
      if (since === null) continue;
      if (!best || since > best.since) best = { row, basis: judgement.basis, since };
    }

    if (best) {
      const ageDays = (startOfLocalDay(now) - best.since) / DAY_MS;
      if (ageDays <= WEEKLY_FRESH_DAYS) {
        return WeeklySelectionService.toCase(best.row, best.basis, best.since, false);
      }
    }

    // 当周没有新案例：回退到最近一条已公开案例（它的资格凭据就是当时的 reason）。
    const published = await WeeklySelectionService.latestPublishedCase();
    if (published) return published;

    // 没有任何已公开页可退时，仍把那条旧的合格机会如实交出去并标注历史。
    if (best) {
      return WeeklySelectionService.toCase(best.row, best.basis, best.since, true);
    }
    return null;
  }

  private static async eligibleSince(
    row: CandidateRow,
    basis: LostFirstMoverBasis,
    facts: LostValueFacts
  ): Promise<number | null> {
    if (basis === 'WINDOW_CLOSING') {
      return (
        dayMs(windowClosingEnteredOn(await loadVerdictRun(row.opportunity_id))) ??
        dayMs(facts.latestVerdictDate)
      );
    }
    if (basis === 'INACTIVE_14D') {
      const lastActive = dayMs(facts.lastActiveVerdictDate);
      // 资格成立于"最后一条活跃裁决之后满 14 天"那一天；从未活跃过就按最新观测日。
      return lastActive !== null ? lastActive + 14 * DAY_MS : dayMs(facts.latestVerdictDate);
    }
    return dayMs(facts.latestVerdictDate);
  }

  private static toCase(
    row: CandidateRow,
    basis: LostFirstMoverBasis,
    since: number,
    historical: boolean
  ): WeeklySelectedCase {
    return {
      opportunityId: row.opportunity_id,
      slug: row.slug,
      title: row.title,
      primaryQuery: row.primary_query,
      verdict: row.verdict,
      whyNowSummary: row.why_now_summary,
      eligibleReason: basis,
      eligibleSince: new Date(since).toISOString(),
      historical,
    };
  }

  private static async latestPublishedCase(): Promise<WeeklySelectedCase | null> {
    const res = await query<
      CandidateRow & { published_at: Date | string | null; eligibility: any }
    >(
      `SELECT pg.opportunity_id, pg.published_at, pg.eligibility,
              c.slug, o.title, c.primary_query, c.verdict, c.why_now_summary
         FROM public_pages pg
         JOIN opportunity_cards c ON c.opportunity_id = pg.opportunity_id
         JOIN opportunities o ON o.id = pg.opportunity_id
        WHERE pg.page_type = 'OPPORTUNITY' AND pg.status = 'PUBLISHED'
          AND pg.locale = 'en-US' AND pg.opportunity_id IS NOT NULL
        ORDER BY pg.published_at DESC NULLS LAST
        LIMIT 1`
    );
    const row = res.rows[0];
    if (!row?.published_at) return null;

    const since = new Date(row.published_at).getTime();
    if (Number.isNaN(since)) return null;

    // 资格理由取自发布时写下的凭据——那是"当时为什么公开它"的原始答案，比今天重算
    // 更接近事实。凭据缺失或取值不认识时退回当前判据；两处都不成立就不硬凑。
    const recorded = row.eligibility?.admission?.basis;
    const basis: LostFirstMoverBasis | null =
      typeof recorded === 'string' && (ELIGIBLE_BASES as readonly string[]).includes(recorded)
        ? (recorded as LostFirstMoverBasis)
        : (await lostFirstMoverValue(row.opportunity_id)).basis;
    if (!basis) return null;

    return WeeklySelectionService.toCase(row, basis, since, true);
  }
}

/**
 * Free 层能打开哪一条机会的详情 / 报告（13 §3.2「摘要 + 精选案例」）。
 *
 * 只有本周精选那一条。资格判据与 Feed 完全同源（`getWeeklySelectedCase`），所以这里
 * 不可能放出一条仍有抢跑价值的机会。返回 `null` 时调用方照旧引导升级。
 */
export async function freeAccessibleOpportunityId(idOrSlug: string, now: Date = new Date()): Promise<string | null> {
  const weekly = await WeeklySelectionService.getWeeklySelectedCase(now);
  if (!weekly) return null;
  return weekly.opportunityId === idOrSlug || weekly.slug === idOrSlug ? weekly.opportunityId : null;
}

/**
 * Free 层的 Feed（13 §3.2）：只返回每周精选的那一条（或没有）。资格判据在
 * `getWeeklySelectedCase`，这里只负责把它变成 Feed 响应。
 */
export async function listFreeWeeklyFeed(
  options: import('./opportunity.service').FeedCardFilterOptions = {}
): Promise<import('./opportunity.service').FeedResponse & { weekly: WeeklySelectedCase | null }> {
  const { OpportunityService } = await import('./opportunity.service');
  const weekly = await WeeklySelectionService.getWeeklySelectedCase();
  const feed = await OpportunityService.listFeedCards({
    ...options,
    minAgeDays: 0,
    offset: 0,
    limit: 1,
    opportunityIds: weekly ? [weekly.opportunityId] : [],
  });
  return { ...feed, weekly };
}
