import { query } from '@emeradar/db';
import { WINDOW_CLOSING_FRESHNESS_DAYS } from '@emeradar/scoring';

/**
 * `docs/15 §3` 的准实时精选**准入判据**，与写入方分成两个模块。
 *
 * 与 `claim-policy.ts` / `stealth-lock-policy.ts` 同构：判据只依赖 `@emeradar/db` 与
 * `@emeradar/scoring`，**绝不 import `public-publication.service`**。反过来的话，
 * `stealth-lock.service.ts` 的投影刷新路径（它 import 发布服务）会与"发布服务 import
 * 买断判据"成环。
 *
 * 拆出来的另一半收益是**可测**：`slotFullness` / `windowClosingState` / `jaccard` /
 * `evaluateCannibalization` 都是纯函数，不碰库就能把边界钉死（见
 * `test/publication-policy.test.ts`），而 `evaluateOpportunity` 要跑一次真实 PostgreSQL
 * 才验得了。
 *
 * 规格里那三个 `publication.*` 配置键（15 §3 的脚注）在仓库里**不存在**运行时可调机制
 * ——没有 config 表、没有 Zod 校验、没有 env。所以这里按仓库一贯做法落成编译期常量，
 * 紧挨消费者并引规格章节，与 `verdict.ts:10`、`claim-policy.ts:16` 同一种写法。
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

export interface SlotTotals {
  slotRows: number;
  capacity: number;
  claimed: number;
}

export interface SlotFullness extends SlotTotals {
  full: boolean;
}

/**
 * 「槽位已满额」= `Σclaimed >= Σcapacity`（15 §3 第 1 条、ADR-018、05 §5.3）。
 *
 * 入参是**按机会汇总后**的计数（`loadSlotTotals` 的返回值，跨形态的求和由 SQL 的
 * `SUM` 完成）——函数本身不再做第二次累加，那会让"跨形态求和"有两份实现。注意它是
 * 单个对象而不是行数组：`slotRows` 是"这条机会有几个形态的槽位行"，它是**数据**而
 * 不是数组长度，混淆这两者会让 `slotRows` 恒等于 1。
 *
 * **`slotRows > 0` 那半条不能省。** 一条没有槽位行的机会，`SUM` 在 SQL 里已经被
 * `COALESCE` 成 0，于是裸比较 `0 >= 0` 会把"这条机会一个槽位都没开"读成"已满额"，
 * 把一条还没开始抢的机会公开出去——而 15 §8 把这件事列为 **0 容忍的 P0**。
 *
 * 用 `>=` 而非 `==`：`0003:52-59` 的 `CHECK (claimed <= capacity)` 让两者等价，而
 * `>=` 对"汇总缓存与真值漂移"（不变量 I11 的夜间一致性检查兜底的那种）更抗——漂移
 * 时宁可判成"已满"（对公开而言是保守方向）也不要把满额读成有空槽。
 */
export function slotFullness(totals: SlotTotals): SlotFullness {
  const capacity = Number(totals.capacity ?? 0);
  const claimed = Number(totals.claimed ?? 0);
  const slotRows = Number(totals.slotRows ?? 0);
  return {
    slotRows,
    capacity,
    claimed,
    full: slotRows > 0 && capacity > 0 && claimed >= capacity,
  };
}

export interface WindowClosingState {
  /** 当前（账本最新一行）的裁决是否就是 `WINDOW_CLOSING`。 */
  current: boolean;
  /** 当前这一段连续 `WINDOW_CLOSING` 的最早观测日；`current` 为假时是 `null`。 */
  enteredOn: string | null;
  /** 从 `enteredOn` 到最新观测日的天数；判不出来时是 `null`。 */
  ageDays: number | null;
  freshnessDays: number;
  /** 是否落在「14 天内新进入」的窗口内——**含端点**。 */
  fresh: boolean;
}

/**
 * 「14 天内新进入 `WINDOW_CLOSING`」（15 §3 第 1 条）——从**账本**的连续同值段读进入时点。
 *
 * 规格的括注写的是 `wDroppedWithin(prev.datedWBandHistory, 14)`，但那是「W 档是否在
 * 14 天内下降过」的**代理**，不是「何时进入 `WINDOW_CLOSING`」。三处会读错，都是硬的：
 *
 *   1. **满额旁路**。`verdict.ts:170-174` 把满额的机会也判成 `WINDOW_CLOSING`，**一次
 *      W 降档都没有**——`wDroppedWithin` 恒为 false。这类机会的进入时点只能从账本读。
 *   2. **粘滞**。`verdict.ts:219-223` 让 `WINDOW_CLOSING` 带 30 天上限地延续，所以
 *      `verdict == 'WINDOW_CLOSING'` **单独不足以**证明「14 天内新进入」：它会把一个
 *      29 天前就关窗的机会当成刚关窗。两个条件必须一起用。
 *   3. **当日进窗**。评分侧构造历史时用的是 `obs_date < today`（不含今天），用它会在
 *      降档当天判否、次日才放行。而 `observeOpportunity`（写账本，`pipeline.ts:220`）
 *      **早于** S8 发布循环（`pipeline.ts:520`），今天的行已经在了——当日进窗就该当日发。
 *
 * `rows` 必须**按 obs_date 倒序**（最新在前），与 `observe-opportunity.ts:474-518` 的
 * 读取约定一致。参考日取 `rows[0].obs_date` 而不是挂钟："同一输入必得同一结果"，
 * 也与 `wDroppedWithin` 的 `asOf` 缺省语义一致。
 *
 * 行数是有限的（`LIMIT 30`）：若入口真在 14 天内，边界必落在前 15 行内；若整段超过
 * 30 行，算出的 `ageDays` 只会偏小而下限仍远大于 14 —— 结论（判否）不变。
 */
export function windowClosingState(rows: Array<{ obs_date: string; verdict: string }>): WindowClosingState {
  const freshnessDays = WINDOW_CLOSING_FRESHNESS_DAYS;
  const head = rows[0];
  if (!head || head.verdict !== 'WINDOW_CLOSING') {
    return { current: false, enteredOn: null, ageDays: null, freshnessDays, fresh: false };
  }

  // 从最新往回走，直到裁决不再是 WINDOW_CLOSING。最后停住的那一行即本段最早的一天。
  let i = 0;
  while (i + 1 < rows.length && rows[i + 1].verdict === 'WINDOW_CLOSING') i++;
  const enteredOn = rows[i].obs_date;

  const headMs = dayMs(head.obs_date);
  const entryMs = dayMs(enteredOn);
  if (Number.isNaN(headMs) || Number.isNaN(entryMs)) {
    // 日期读不出来就判否，不去猜 —— 分支②只会**放行**公开，失败方向取严是正确的一侧。
    return { current: true, enteredOn, ageDays: null, freshnessDays, fresh: false };
  }
  const ageDays = Math.round((headMs - entryMs) / 86_400_000);
  return { current: true, enteredOn, ageDays, freshnessDays, fresh: ageDays <= freshnessDays };
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

/** 槽位汇总。读 `claimed` 这个汇总缓存而非 `COUNT(*)`，正是 `0003:81` 与 ADR-018 指定的做法。 */
export async function loadSlotTotals(opportunityId: string): Promise<SlotTotals> {
  const res = await query<{ slot_rows: number; capacity: number; claimed: number }>(
    `SELECT COUNT(*)::int AS slot_rows,
            COALESCE(SUM(capacity),0)::int AS capacity,
            COALESCE(SUM(claimed),0)::int  AS claimed
       FROM opportunity_slots WHERE opportunity_id = $1`,
    [opportunityId]
  );
  const row = res.rows[0];
  return {
    slotRows: Number(row?.slot_rows ?? 0),
    capacity: Number(row?.capacity ?? 0),
    claimed: Number(row?.claimed ?? 0),
  };
}

/**
 * 账本尾部若干行，**含今日**、按 obs_date 倒序。
 *
 * `to_char` 不是装饰：驱动没有 DATE 类型解析器，DATE 会被读成**本地时区午夜**的
 * Date 对象，在 UTC+08:00 这类时区下再 `toISOString()` 会整体退一天——而"14 天内"
 * 的判据正是建立在这个日期上（`observe-opportunity.ts:471-473` 记着同一个坑）。
 *
 * `LIMIT 30` 的理由见 `windowClosingState`。
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
 * 污染（`stealth-lock.test.ts` 每个用例自造机会），而且 `publishOpportunity` 也被
 * 长驻的 web 进程调用（买断侧的投影刷新），缓存会在那里变 stale。显式传参可测、
 * 无隐藏状态。
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
