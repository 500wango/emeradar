import { query } from '@emeradar/db';
import { WINDOW_CLOSING_FRESHNESS_DAYS } from '@emeradar/scoring';

/**
 * `docs/15 §3` 的准实时精选**准入判据**，与写入方分成两个模块。
 *
 * 判据只依赖 `@emeradar/db` 与 `@emeradar/scoring`，**绝不 import
 * `public-publication.service`**：写入方要 import 判据，判据再反过来 import 写入方
 * 就成环。
 *
 * 拆出来的另一半收益是**可测**：`evaluateLostFirstMoverValue` / `jaccard` /
 * `evaluateCannibalization` 都是纯函数，不碰库就能把边界钉死（见
 * `test/publication-policy.test.ts`），而 `evaluateOpportunity` 要跑一次真实 PostgreSQL
 * 才验得了。
 *
 * 规格里那三个 `publication.*` 配置键（15 §3 的脚注）在仓库里**不存在**运行时可调机制
 * ——没有 config 表、没有 Zod 校验、没有 env。所以这里按仓库一贯做法落成编译期常量，
 * 紧挨消费者并引规格章节，与 `verdict.ts:10` 同一种写法。
 *
 * v3.1 的准入判据是「已失去抢跑价值」（15 §3、01 §1.8）：当前裁决为
 * `WINDOW_CLOSING` / `PASS`、生命周期已进入竞争态，或连续 14 天没有出现过
 * `BUILD_NOW` / `EARLY_BET`。活跃的 BUILD_NOW / EARLY_BET **永不公开**。
 */

/** 15 §3 第 3 条 的 `publication.cannibalization_max_jaccard`，默认 0.7。 */
export const CANNIBALIZATION_MAX_JACCARD = 0.7;

/** 15 §3 第 3 条 的「Top10 重叠度」——取 SERP 排名 1..10 的结果 URL 集合。 */
export const SERP_TOP_N = 10;

/**
 * 14 天从评分侧转出，**不在这里另写一个**：`verdict.ts:9` 的注释写明它与 15 §3 的
 * `publication.window_closing_freshness_days` 同源。两处各写一个 14，就是下一个漂移点。
 */
export { WINDOW_CLOSING_FRESHNESS_DAYS };

/** 只解析日期部分，一律按 UTC 午夜解释。 */
function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * 「今天」的日历日起点，按 UTC 毫秒表示。
 *
 * 用**本地**日历字段而不是 `toISOString().slice(0,10)`：`lastActiveVerdictDate` 来自
 * 数据库的 `CURRENT_DATE`（服务器时区），而 UTC+08:00 的凌晨会让两者相差一天——
 * 14 天窗口的边界正好落在那一天上。两侧必须用同一套日历。
 */
export function startOfLocalDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * 「已失去抢跑价值」的四个判据（15 §3、01 §1.8 第 5 条、§2.4）。
 *
 * 顺序即优先级：裁决面的事实优先于生命周期，生命周期优先于"14 天没动过"。
 */
export type LostFirstMoverBasis = 'WINDOW_CLOSING' | 'PASS' | 'LIFECYCLE_CLOSED' | 'INACTIVE_14D';

/** 连续这么多天（含端点）没有 `BUILD_NOW` / `EARLY_BET`，就认为窗口已经沉寂。 */
export const INACTIVE_WINDOW_DAYS = 14;

/** 已进入竞争态的三种生命周期（05 生命周期图）。 */
export const CLOSED_LIFECYCLES = ['CONTESTED', 'MATURE', 'DEAD'] as const;

/** 判据需要的三个事实，一次查询取齐（见 `loadLostValueFacts`）。 */
export interface LostValueFacts {
  /** 最新一条裁决（`ORDER BY obs_date DESC`）。 */
  latestVerdict: string | null;
  /** 最新一条裁决的观测日（`YYYY-MM-DD`）。 */
  latestVerdictDate: string | null;
  lifecycle: string | null;
  /** 最近一条 `BUILD_NOW` / `EARLY_BET` 的观测日；从未出现过则是 `null`。 */
  lastActiveVerdictDate: string | null;
}

export interface LostFirstMoverValue {
  eligible: boolean;
  basis: LostFirstMoverBasis | null;
  facts: LostValueFacts;
}

export interface LostValueEvaluation {
  eligible: boolean;
  basis: LostFirstMoverBasis | null;
}

function emptyFacts(): LostValueFacts {
  return { latestVerdict: null, latestVerdictDate: null, lifecycle: null, lastActiveVerdictDate: null };
}

/**
 * 「已失去抢跑价值」的**唯一**判据（15 §3、01 §1.8 第 5 条）。
 *
 * 三条判据任一成立即可公开；顺序固定，凭据记第一条命中的：
 *
 *   1. 最新裁决是 `WINDOW_CLOSING` 或 `PASS`——窗口已经关了，或机会已经被否掉；
 *   2. 生命周期是 `CONTESTED` / `MATURE` / `DEAD`——竞争已经发生，不再是无人区；
 *   3. 连续 14 天（含端点）没有任何一条 `BUILD_NOW` / `EARLY_BET`。
 *
 * **先判活跃**：最新裁决是 `BUILD_NOW` / `EARLY_BET` 时一律不公开，哪怕生命周期
 * 已经写成 `CONTESTED`。这是 15 §8 那条 0 容忍指标的正面要求——活跃窗口的正文、
 * slug 与词根都不能出现在免费层。
 *
 * 第 3 条的窗口是 `[today-13, today]`（"14 天含端点"）：最近一条活跃裁决落在
 * `today-13` 仍在窗口内（不公开），落在 `today-14` 才放行。用注入的 `today` 而不是
 * 读几次挂钟，同一个输入必得同一个结论。
 */
export function evaluateLostFirstMoverValue(
  facts: LostValueFacts,
  today: Date = new Date()
): LostValueEvaluation {
  const latest = facts.latestVerdict;
  if (latest === 'BUILD_NOW' || latest === 'EARLY_BET') {
    return { eligible: false, basis: null };
  }
  if (latest === 'WINDOW_CLOSING') return { eligible: true, basis: 'WINDOW_CLOSING' };
  if (latest === 'PASS') return { eligible: true, basis: 'PASS' };
  if (facts.lifecycle && (CLOSED_LIFECYCLES as readonly string[]).includes(facts.lifecycle)) {
    return { eligible: true, basis: 'LIFECYCLE_CLOSED' };
  }

  const todayMs = startOfLocalDay(today);
  const cutoffMs = todayMs - (INACTIVE_WINDOW_DAYS - 1) * 86_400_000;
  if (!facts.lastActiveVerdictDate) {
    // 从来没有活跃过：14 天里当然没有活跃裁决。
    return { eligible: true, basis: 'INACTIVE_14D' };
  }
  const lastMs = dayMs(facts.lastActiveVerdictDate);
  if (Number.isNaN(lastMs)) {
    // 日期读不出来就不放行——失败方向取严，与 15 §8 的 0 容忍一致。
    return { eligible: false, basis: null };
  }
  return lastMs < cutoffMs
    ? { eligible: true, basis: 'INACTIVE_14D' }
    : { eligible: false, basis: null };
}

/**
 * 批量取判据事实。一条机会一次往返不够，但一次发布/周精选会问几十条，逐条查会把
 * 「一天一条 SQL」变成「一轮几十条」——所以这里按 id 数组一次取齐。
 */
export async function loadLostValueFacts(opportunityIds: string[]): Promise<Map<string, LostValueFacts>> {
  const unique = [...new Set(opportunityIds.filter(Boolean))];
  const facts = new Map<string, LostValueFacts>();
  if (unique.length === 0) return facts;

  const res = await query<{
    opportunity_id: string;
    latest_verdict: string | null;
    latest_verdict_date: string | null;
    lifecycle: string | null;
    last_active_verdict_date: string | null;
  }>(
    `SELECT o.id AS opportunity_id,
            (SELECT v.verdict FROM verdicts v
              WHERE v.opportunity_id = o.id
              ORDER BY v.obs_date DESC, v.created_at DESC LIMIT 1) AS latest_verdict,
            (SELECT to_char(v.obs_date, 'YYYY-MM-DD') FROM verdicts v
              WHERE v.opportunity_id = o.id
              ORDER BY v.obs_date DESC, v.created_at DESC LIMIT 1) AS latest_verdict_date,
            (SELECT c.lifecycle FROM opportunity_cards c WHERE c.opportunity_id = o.id) AS lifecycle,
            (SELECT to_char(MAX(v.obs_date), 'YYYY-MM-DD') FROM verdicts v
              WHERE v.opportunity_id = o.id
                AND v.verdict IN ('BUILD_NOW','EARLY_BET')) AS last_active_verdict_date
       FROM opportunities o
      WHERE o.id = ANY($1::text[])`,
    [unique]
  );

  for (const row of res.rows) {
    facts.set(row.opportunity_id, {
      latestVerdict: row.latest_verdict ?? null,
      latestVerdictDate: row.latest_verdict_date ?? null,
      lifecycle: row.lifecycle ?? null,
      lastActiveVerdictDate: row.last_active_verdict_date ?? null,
    });
  }
  for (const id of unique) if (!facts.has(id)) facts.set(id, emptyFacts());
  return facts;
}

/** 单条机会的「已失去抢跑价值」判定。 */
export async function lostFirstMoverValue(
  opportunityId: string,
  today: Date = new Date()
): Promise<LostFirstMoverValue> {
  const facts = (await loadLostValueFacts([opportunityId])).get(opportunityId) ?? emptyFacts();
  return { ...evaluateLostFirstMoverValue(facts, today), facts };
}

/**
 * 当前这一段连续 `WINDOW_CLOSING` 的最早观测日；最新一行不是它时返回 `null`。
 *
 * 只服务周精选的「资格成立时点」（展示口径），不再承担准入判定：v3.1 的
 * `WINDOW_CLOSING` **不要求新鲜**——窗口关了就是关了，20 天前关的窗和第 1 天关的
 * 窗一样没有抢跑价值。
 *
 * `rows` 必须按 obs_date 倒序（最新在前）。
 */
export function windowClosingEnteredOn(
  rows: Array<{ obs_date: string; verdict: string }>
): string | null {
  const head = rows[0];
  if (!head || head.verdict !== 'WINDOW_CLOSING') return null;
  let i = 0;
  while (i + 1 < rows.length && rows[i + 1].verdict === 'WINDOW_CLOSING') i++;
  return rows[i].obs_date;
}

/**
 * SERP 结果 URL 的**身份**归一——两侧必须共用这一个函数，因为"两个结果是不是同一个
 * 页面"的答案要与它一致，而一致性比归一化强度重要得多。
 *
 * 只做下界归一：去 scheme、去 `www.`、去 fragment、去尾斜杠、小写主机名。**刻意不
 * 去掉 query string**：那会把 `/a?p=1` 与 `/a?p=2` 合并成同一个页面，是我们替对方
 * 做了不该做的判断。
 *
 * 方向性说明：归一化只会让两个集合**更容易重叠**（更保守 = 挡得更多 = 少公开），而
 * 「少公开」正是这条判据出错时安全的那一侧。
 */
export function normalizeSerpUrl(url: string): string {
  const raw = (url || '').trim();
  if (!raw) return '';
  let rest = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  rest = rest.split('#')[0];
  const slash = rest.indexOf('/');
  let host = slash < 0 ? rest : rest.slice(0, slash);
  let path = slash < 0 ? '' : rest.slice(slash);
  host = host.replace(/^www\./i, '').toLowerCase();
  path = path.replace(/\/+$/, '');
  if (!host) return '';
  return `${host}${path}` || host;
}

/** Jaccard 相似度。两边都空时定义为 0——"都没有结果"不是"完全重叠"。 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const value of a) if (b.has(value)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type CannibalizationStatus = 'VACUOUS' | 'PASSED' | 'BLOCKED' | 'NOT_EVALUATED';

export interface CannibalizationResult {
  status: CannibalizationStatus;
  threshold: number;
  maxJaccard: number;
  closestSlug: string | null;
  candidateTop10Size: number;
  /** 真正算出 Jaccard 的已收录页数。 */
  comparedPages: number;
  /** 已收录（`PUBLISHED AND indexable`）的机会页总数。 */
  publishedPages: number;
  /** 有页、但一侧拿不到 Top10 集合而无法比较的页数。 */
  unresolvablePages: number;
}

export interface CannibalizationIndex {
  readonly locale: string;
  /** key 是 `opportunity_id`；`urls` 为空集表示这一页拿不到 Top10。 */
  readonly pages: Map<string, { slug: string; urls: Set<string> }>;
  addPublished(opportunityId: string, slug: string, urls: Iterable<string>): void;
}

/**
 * 15 §3 第 3 条 的蚕食防护。
 *
 * 「已收录」的口径是 `PUBLISHED AND indexable = true`，与 `sitemap.ts:20` 同一口径：
 * 蚕食说的是**在 Google 里争同一个词**，而打码页与未过质检的 `indexable = false` 页
 * 既不进 sitemap 也不会被收录，不构成冲突。这个口径有一个可见的后果，值得写下来：
 * 今天 `indexable` 恒为 false（15 §5 的 600 词门过不了），所以这条检查实际上长期是
 * `VACUOUS`——**不要据此以为蚕食逻辑没生效**。
 *
 * 四种状态必须彼此区分，因为处置方向不同：
 *
 *   - `VACUOUS`：已收录页数 = 0，没有可蚕食的对象 → 通过。库里一条已发布页都没有
 *     的库（比如 dev）走的就是这一支。
 *   - `PASSED` / `BLOCKED`：算出来了，按 `>= 0.7` 阻断（规格是"`< 0.7` 允许"）。
 *   - `NOT_EVALUATED`：**有**已收录页，但候选或对侧拿不到 Top10 集合 → **阻断**，并把
 *     `cannibalization` 写进 `notEvaluated`。
 *
 * `VACUOUS` 与 `NOT_EVALUATED` 合并会掩盖真实差别："表是空的"与"数据缺失"是两件事，
 * 前者无可蚕食，后者是检查没跑成。合并之后 dev 库的现象会被读成后者。
 *
 * `NOT_EVALUATED` 取 fail-closed，而不是"拿别的条件顶上"：仓库对"未实现的检查"的
 * 惯例是显式登记（`public-publication.service.ts:96-104` 的 `notEvaluated`、
 * `alert-triggers.ts:48-55` 的 `UNIMPLEMENTED_RULE_TYPES`），但这里检查本身是**实现了**
 * 的，缺的是数据。一旦有页可被索引，蚕食就是真问题，静默放过等于让检查形同虚设；
 * 而 `CANNIBALIZATION_DATA_MISSING` 这个阻断码是可计数的，能把 SERP 覆盖缺口变成
 * **可见**的指标（上线后应加一个计数观察）。状态、`notEvaluated`、`blockedBy` 三处
 * 都如实写出来了，所以这不是顶替，是登记。
 *
 * `excludeOpportunityId` 是必需的：索引按运行构建一次、被整批机会共用，候选自己若
 * 已发布就在索引里，与自身重叠恒为 1.0 → 永远 `BLOCKED`。排除必须按候选逐次做，
 * 不能写进索引的 SQL。
 */
export function evaluateCannibalization(
  candidateUrls: readonly string[],
  index: CannibalizationIndex,
  excludeOpportunityId?: string
): CannibalizationResult {
  const candidate = new Set(candidateUrls.map(normalizeSerpUrl).filter(Boolean));
  const publishedPages = index.pages.size;
  const base = {
    threshold: CANNIBALIZATION_MAX_JACCARD,
    candidateTop10Size: candidate.size,
    publishedPages,
  };

  if (publishedPages === 0) {
    return { ...base, status: 'VACUOUS', maxJaccard: 0, closestSlug: null, comparedPages: 0, unresolvablePages: 0 };
  }

  let maxJaccard = 0;
  let closestSlug: string | null = null;
  let comparedPages = 0;
  let unresolvablePages = 0;

  for (const [opportunityId, page] of index.pages) {
    if (excludeOpportunityId && opportunityId === excludeOpportunityId) continue;
    // 候选或对侧空了就算不出来 —— 分开累计，不要与"算出来是 0"混为一谈。
    if (page.urls.size === 0 || candidate.size === 0) {
      unresolvablePages++;
      continue;
    }
    comparedPages++;
    const similarity = jaccard(candidate, page.urls);
    if (similarity > maxJaccard) {
      maxJaccard = similarity;
      closestSlug = page.slug;
    }
  }

  if (comparedPages === 0) {
    return { ...base, status: 'NOT_EVALUATED', maxJaccard: 0, closestSlug: null, comparedPages: 0, unresolvablePages };
  }
  return {
    ...base,
    status: maxJaccard >= CANNIBALIZATION_MAX_JACCARD ? 'BLOCKED' : 'PASSED',
    maxJaccard,
    closestSlug,
    comparedPages,
    unresolvablePages,
  };
}

// ---------------------------------------------------------------------------
// DB loaders
// ---------------------------------------------------------------------------

/**
 * 账本尾部若干行，**含今日**、按 obs_date 倒序。
 *
 * `to_char` 不是装饰：驱动没有 DATE 类型解析器，DATE 会被读成**本地时区午夜**的
 * Date 对象，在 UTC+08:00 这类时区下再 `toISOString()` 会整体退一天——而"14 天内"
 * 的判据正是建立在这个日期上（`observe-opportunity.ts:471-473` 记着同一个坑）。
 *
 * `LIMIT 30` 的理由见 `windowClosingEnteredOn`。
 */
export async function loadVerdictRun(
  opportunityId: string,
  limit = 30
): Promise<Array<{ obs_date: string; verdict: string }>> {
  const res = await query<{ obs_date: string; verdict: string }>(
    `SELECT to_char(v.obs_date, 'YYYY-MM-DD') AS obs_date, v.verdict
       FROM verdicts v WHERE v.opportunity_id = $1
       ORDER BY v.obs_date DESC LIMIT $2`,
    [opportunityId, limit]
  );
  return res.rows;
}

/** 候选机会 PRIMARY query 的最新 SERP 快照 Top-N 结果 URL。范式同 `opportunity.service.ts:602-611`。 */
export async function loadPrimaryTopNUrls(opportunityId: string, n = SERP_TOP_N): Promise<string[]> {
  const res = await query<{ url: string }>(
    `SELECT r.url
       FROM serp_snapshots s
       JOIN opportunity_queries oq ON oq.query_id = s.query_id AND oq.role = 'PRIMARY' AND oq.opportunity_id = $1
       JOIN serp_results r ON r.serp_snapshot_id = s.id AND r.rank <= $2
      WHERE s.obs_date = (
        SELECT MAX(s2.obs_date) FROM serp_snapshots s2
        JOIN opportunity_queries oq2 ON oq2.query_id = s2.query_id AND oq2.opportunity_id = $1 AND oq2.role = 'PRIMARY'
      )`,
    [opportunityId, n]
  );
  return res.rows.map((row) => row.url);
}

/**
 * 构建"已收录页 → Top10 集合"的索引，**每轮 S8 运行只建一次**并透传给整批机会。
 *
 * 透传不是优化而是必需：按次自加载的话，N 条机会每条都要拉一遍全量已收录集合，行数
 * 是 `N × 10M`（M = 已收录机会页数）——`M = 1000` 时就是 10⁷ 行级。
 *
 * **刻意不做模块级缓存。** `packages/services/src` 是单例模块，进程内缓存会跨用例
 * 污染（每个用例自造机会），而且 `publishOpportunity` 也被长驻的 web 进程调用，
 * 缓存会在那里变 stale。显式传参可测、无隐藏状态。
 *
 * 用 `LEFT JOIN` 链而不是内连接：**拿不到快照的已收录页也必须出现在 `pages` 里**
 * （`urls` 为空集）。否则它会被整体漏掉，`publishedPages` 少数一页，于是"有页但比较
 * 不了"会被误报成"没有页可比较"——正是 `VACUOUS` 与 `NOT_EVALUATED` 要分开的那件事。
 */
export async function buildCannibalizationIndex(locale = 'en-US'): Promise<CannibalizationIndex> {
  const res = await query<{ opportunity_id: string; slug: string; url: string | null }>(
    `SELECT pp.opportunity_id, pp.slug, r.url
       FROM public_pages pp
       LEFT JOIN opportunity_queries oq ON oq.opportunity_id = pp.opportunity_id AND oq.role = 'PRIMARY'
       LEFT JOIN LATERAL (
         SELECT s.id FROM serp_snapshots s WHERE s.query_id = oq.query_id ORDER BY s.obs_date DESC LIMIT 1
       ) ls ON TRUE
       LEFT JOIN serp_results r ON r.serp_snapshot_id = ls.id AND r.rank <= $2
      WHERE pp.page_type = 'OPPORTUNITY' AND pp.status = 'PUBLISHED' AND pp.indexable = true
        AND pp.locale = $1 AND pp.opportunity_id IS NOT NULL`,
    [locale, SERP_TOP_N]
  );

  const pages = new Map<string, { slug: string; urls: Set<string> }>();
  for (const row of res.rows) {
    let entry = pages.get(row.opportunity_id);
    if (!entry) {
      entry = { slug: row.slug, urls: new Set<string>() };
      pages.set(row.opportunity_id, entry);
    }
    const normalized = row.url ? normalizeSerpUrl(row.url) : '';
    if (normalized) entry.urls.add(normalized);
  }

  return {
    locale,
    pages,
    /**
     * 同一轮运行内把刚发布的页追加进来，让后面的机会能看见前面的。
     *
     * 没有这一步，同一批里两条近重复机会会**都**发布，下一轮第二条被翻成 `DRAFT`
     * ——白跑一次改写，还多一次 404 抖动。这是有意的副作用。
     */
    addPublished(opportunityId: string, slug: string, urls: Iterable<string>): void {
      const set = new Set<string>();
      for (const url of urls) {
        const normalized = normalizeSerpUrl(url);
        if (normalized) set.add(normalized);
      }
      pages.set(opportunityId, { slug, urls: set });
    },
  };
}
