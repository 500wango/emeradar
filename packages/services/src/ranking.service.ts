import { query, transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { normalizeHostname } from './credential-host';

/**
 * 无感 SERP 排名追踪（PRD F1.1 / F10、02 §5、19 Epic 1.5）。
 *
 * 这是整个产品"出货导向"那句定位（PRD P4）**唯一**能被度量的地方：系统的成功以
 * "用户立项后 30 天内是否真的进入搜索 Top 100"衡量，而不是以浏览量衡量。Gate 1 的
 * 第二条红线（30 天 Top 100 入榜率 ≥ 30%）就是从这里读出来的。
 *
 * 三条设计上的取舍：
 *
 * 1. **零新增采集请求**。排名不是单独去查的：S 管线本来就要为评分采一次 Top 100
 *    （04 §9.2 一鱼多吃），前 10 名进评分，其余在内存里与已核验项目的 `host` 比对。
 *    为追踪再加一轮请求会让"500 活跃用户下月度 SERP 成本 < $20"（04 §6）不成立。
 *
 * 2. **未入榜也要落一行**（`best_rank IS NULL`）。只记录"进榜了"的那些天，会让
 *    "30 天内首次入榜"变成一句无法证伪的话——分母消失了，剩下的一律是命中。所以
 *    每个被追踪的项目在每个观测日都有一行，无论结果如何。
 *
 * 3. **只记事实，不记曲线**。表里存的是逐日的 `best_rank` 与 `matched_url`，爬升
 *    曲线（"未入榜 → 第 68 → 第 12"）由读路径算出来。把曲线也算好存下来，等于给
 *    同一件事造第二份真相。
 */

/** 匹配的输入：一次 SERP 采集里除评分集以外的全部名次。 */
export interface SerpRankEntry {
  rank: number;
  url: string;
  domain: string;
}

export interface RankRecordingResult {
  /** 这次观测覆盖到的已核验项目数（含未入榜的）。 */
  tracked: number;
  /** 其中当天进入 Top 100 的。 */
  matched: number;
}

/**
 * 曲线上的一行，字段名对齐 10 §4.5 的 `GET /projects/{id}/serp-rankings`。
 *
 * `rank` 是**当日最好**的名次：同一个主机名可以有多条结果在榜上（首页排第 7、定价页
 * 排第 42），曲线要说的是"这个项目最高到哪"，不是"它第一条命中的结果排第几"。
 * `rank: null` 是一行的**正常取值**——当日未进入采集深度，而不是"没有这一行"。
 */
export interface RankRow {
  date: string;
  rank: number | null;
  matchedUrl: string | null;
  /**
   * 命中来自哪一类凭证（`credential_type`，00-INDEX §4.3）。
   *
   * 这一列存在的意义是让"匹配有多可信"可被看见：`DOMAIN_URL` 是本项目自己的域名，
   * 命中即真；`STORE_LISTING_URL` 只按主机名匹配，所以同应用商店里的**任意**一个
   * 页面都会命中——那种命中是线索，不是证据。不区分这两者，等于把一条弱信号画成
   * 和强信号一模一样的曲线。
   */
  matchedVia: string | null;
}

export interface QueryRankSeries {
  queryId: string;
  queryText: string;
  rows: RankRow[];
  /** 历史最好名次（数字越小越好）；从未入榜为 null。 */
  bestRankEver: number | null;
  /** 首次被观测到进入深度之内那一天；尚未入榜为 null。 */
  firstRankedOn: string | null;
}

export interface ProjectRankingView {
  projectId: string;
  /** 项目立项日期，用来算"多少天入榜"。 */
  projectCreatedAt: string;
  /** 有观测的天数（含未入榜的天）。 */
  observedDays: number;
  firstRankedOn: string | null;
  /** 立项到首次入榜的自然日数；尚未入榜为 null。 */
  daysToFirstRank: number | null;
  bestRankEver: number | null;
  series: QueryRankSeries[];
}

/** 12 §2 `PROJECT_SERP_RANK_JUMP`：较上次观测排名跃升 ≥ 该名次数即告警（默认值，冻结前可调）。 */
export const RANK_JUMP_THRESHOLD = 10;
const RANK_TIERS = [10, 30, 100] as const;

export interface RankJump {
  kind: 'FIRST_ENTRY' | 'TIER_ENTRY' | 'JUMP';
  /** 本次所处的名次档（10 / 30 / 100）。 */
  tier: number;
  rank: number;
  previousRank: number | null;
}

/**
 * 是否构成排名跃升事件。纯函数，便于直接测。
 *
 * - `previous`：此前**所有**观测里的最好名次（NULL 表示从未进榜）；`last` 是上一次观测。
 * - 首次进入 Top 100、首次进入 Top 30 / Top 10（历史最好从未达到该档）、或较上一次观测
 *   跃升 ≥ 阈值，都算；三者取最强的一个返回，同一天只提醒一次。
 * - `rank` 为 NULL（今天没进榜）永远不触发。
 */
export function detectRankJump(
  rank: number | null,
  last: number | null,
  bestEver: number | null,
  threshold = RANK_JUMP_THRESHOLD
): RankJump | null {
  if (rank === null) return null;
  const tier = RANK_TIERS.find((t) => rank <= t) ?? 100;
  if (bestEver === null) return { kind: 'FIRST_ENTRY', tier, rank, previousRank: null };
  const bestTier = RANK_TIERS.find((t) => bestEver <= t) ?? 101;
  if (tier < bestTier) return { kind: 'TIER_ENTRY', tier, rank, previousRank: last };
  if (last !== null && last - rank >= threshold) return { kind: 'JUMP', tier, rank, previousRank: last };
  return null;
}

export class RankingService {
  /**
   * 把一次 SERP 采集的结果与已核验项目对上，写入 `project_serp_rankings`。
   *
   * 由 S 管线在写完快照后调用，`rankIndex` 是采集侧在内存里留下的名次索引。
   */
  static async recordFromSerp(input: {
    opportunityId: string;
    queryId: string;
    obsDate: string;
    rankIndex: readonly SerpRankEntry[];
  }): Promise<RankRecordingResult> {
    // 被追踪的是"**已核验**的项目"，不是"占用着槽位的项目"。两者的区别在槽位被释放
    // 之后才显形：项目还在，用户还在做，只是位置让给了别人——此时停止追踪会把一条
    // 已经开始的爬升曲线拦腰截断，而那条曲线正是要交给用户看的东西。
    const tracked = await query<{ project_id: string; host: string; credential_type: string }>(
      `SELECT pc.project_id, pc.host, pc.credential_type
         FROM project_credentials pc
         JOIN projects p ON p.id = pc.project_id
        WHERE p.opportunity_id = $1
          AND p.status <> 'ARCHIVED'
          AND pc.verification_state = 'VERIFIED'
          AND pc.host IS NOT NULL`,
      [input.opportunityId]
    );
    if (tracked.rows.length === 0) return { tracked: 0, matched: 0 };

    // 同一主机名可能出现多次（首页 + 内页都排上了），取**最好**的那个名次——曲线要说
    // 的是"这个项目在榜上最高到哪"，不是"它第一条命中的结果排第几"。
    const best = new Map<string, { rank: number; url: string }>();
    for (const entry of input.rankIndex) {
      const host = normalizeHostname(entry.domain);
      if (!host) continue;
      const current = best.get(host);
      if (!current || entry.rank < current.rank) best.set(host, { rank: entry.rank, url: entry.url });
    }

    let matched = 0;
    await transaction(async (client) => {
      for (const row of tracked.rows) {
        // 存下来的 `host` 也过一遍同一把尺子：0006 的回填是尽力而为的 SQL 版本，
        // 留下的值未必与解析出来的主机名逐字相同（例如尾部有点）。两侧分别归一，
        // 才不会因为一个字符之差把一次命中算成没命中。
        const host = normalizeHostname(row.host);
        const hit = host ? best.get(host) : undefined;
        if (hit) matched += 1;
        // 未入榜时写一行 best_rank IS NULL，而不是跳过：跳过会让"连续 60 天没进榜"
        // 与"这 60 天我们没在看"在库里长得一模一样。
        // 先读历史再写今天：跃升是「相对此前」的判断，写完再读就读到自己了。
        const history = await client.query<{ last: number | null; best: number | null }>(
          `SELECT (SELECT best_rank FROM project_serp_rankings
                    WHERE project_id = $1 AND query_id = $2 AND obs_date < $3::date
                    ORDER BY obs_date DESC LIMIT 1) AS last,
                  (SELECT MIN(best_rank) FROM project_serp_rankings
                    WHERE project_id = $1 AND query_id = $2 AND obs_date < $3::date) AS best`,
          [row.project_id, input.queryId, input.obsDate]
        );
        const jump = detectRankJump(hit?.rank ?? null, history.rows[0]?.last ?? null, history.rows[0]?.best ?? null);
        if (jump) {
          const owner = await client.query<{ user_id: string; title: string }>(
            `SELECT user_id, title FROM projects WHERE id = $1`,
            [row.project_id]
          );
          if (owner.rows[0]) {
            const tierLabel = `Top ${jump.tier}`;
            const body =
              jump.kind === 'JUMP'
                ? `Your page moved from #${jump.previousRank} to #${jump.rank} for this keyword.`
                : `Your page entered ${tierLabel} for this keyword (now #${jump.rank}).`;
            await client.query(
              `INSERT INTO notifications (id, user_id, title, body)
               VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
              [
                `ntf_rank_${row.project_id}_${input.queryId}_${input.obsDate}`,
                owner.rows[0].user_id,
                `Ranking update: ${owner.rows[0].title}`,
                body,
              ]
            );
          }
        }
        await client.query(
          `INSERT INTO project_serp_rankings (project_id, query_id, obs_date, best_rank, matched_url)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_id, query_id, obs_date) DO UPDATE SET
             best_rank = EXCLUDED.best_rank,
             matched_url = EXCLUDED.matched_url`,
          [row.project_id, input.queryId, input.obsDate, hit?.rank ?? null, hit?.url ?? null]
        );
      }
    });

    return { tracked: tracked.rows.length, matched };
  }

  /**
   * 读路径：某个项目的排名爬升曲线。
   *
   * 权限判据与项目详情页一致（10 §4.4）：不是自己的项目一律 404，而不是 403——
   * 排名曲线里含对手的具体域名与名次，不该靠"项目 id 不可枚举"来保护。
   */
  static async getProjectRankings(projectId: string, userId: string): Promise<ProjectRankingView> {
    const projectRes = await query<{ created_at: Date }>(
      `SELECT created_at FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    const project = projectRes.rows[0];
    if (!project) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    }

    const rankRes = await query<{
      query_id: string;
      query_text: string;
      obs_date: string;
      best_rank: number | null;
      matched_url: string | null;
      matched_via: string | null;
    }>(
      // `matched_via` 由当前生效的已核验凭证推导，而不是存在 `project_serp_rankings`
      // 里：它是一句归因说明，不参与匹配（匹配只按 host），不值得为它加一列并在
      // 每次写入时同步。代价是——同一项目若日后换用另一类凭证重新核验，历史行的
      // 归因会跟着改，而 `matched_url` 仍是当时那一条。两者的这一处不一致是有意
      // 接受的：`matched_url` 是事实，`matched_via` 是提示。
      `SELECT r.query_id, q.query_text, r.obs_date::text AS obs_date, r.best_rank, r.matched_url,
              CASE WHEN r.best_rank IS NULL THEN NULL ELSE pc.credential_type END AS matched_via
         FROM project_serp_rankings r
         JOIN queries q ON q.id = r.query_id
         LEFT JOIN project_credentials pc
                ON pc.project_id = r.project_id AND pc.verification_state = 'VERIFIED'
        WHERE r.project_id = $1
        ORDER BY r.obs_date ASC, r.query_id ASC`,
      [projectId]
    );
    const rows = rankRes.rows;

    const byQuery = new Map<string, QueryRankSeries>();
    for (const row of rows) {
      let series = byQuery.get(row.query_id);
      if (!series) {
        series = {
          queryId: row.query_id,
          queryText: row.query_text,
          rows: [],
          bestRankEver: null,
          firstRankedOn: null,
        };
        byQuery.set(row.query_id, series);
      }
      series.rows.push({
        date: row.obs_date,
        rank: row.best_rank,
        matchedUrl: row.matched_url,
        matchedVia: row.matched_via,
      });
      if (row.best_rank !== null) {
        if (series.bestRankEver === null || row.best_rank < series.bestRankEver) {
          series.bestRankEver = row.best_rank;
        }
        // 行按 obs_date 升序，所以第一次遇到就是最早那次。
        if (series.firstRankedOn === null) series.firstRankedOn = row.obs_date;
      }
    }

    const series = [...byQuery.values()];
    // 有观测的天数按**日期**去重：多条查询各自一行，但"我们看了几天"是一个数。
    const observedDays = new Set(rows.map((row) => row.obs_date)).size;
    const firstRankedOn = series
      .map((entry) => entry.firstRankedOn)
      .filter((value): value is string => value !== null)
      .sort()[0] ?? null;
    const bestRankEver = series.reduce<number | null>(
      (best, entry) =>
        entry.bestRankEver === null ? best : best === null ? entry.bestRankEver : Math.min(best, entry.bestRankEver),
      null
    );

    return {
      projectId,
      projectCreatedAt: project.created_at.toISOString(),
      observedDays,
      firstRankedOn,
      daysToFirstRank: firstRankedOn ? daysBetween(project.created_at, firstRankedOn) : null,
      bestRankEver,
      series,
    };
  }
}

/** 自然日差。用 UTC 零点做差，避免夏令时把 30 天算成 29 或 31。 */
function daysBetween(from: Date, toIsoDate: string): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const [year, month, day] = toIsoDate.split('-').map(Number);
  const end = Date.UTC(year, month - 1, day);
  return Math.round((end - start) / 86_400_000);
}
