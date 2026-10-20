/**
 * 选题入口：从「工具意图」种子词出发取 Google 长尾词（DataForSEO Labs
 * `keyword_suggestions`，经 AIsa 代理或直连）。
 *
 * 为什么不再从新闻标题出发：HN / TechCrunch 标题衍生出的是 "creator of pokemon"、
 * "ai startup valuation multiple" 这类词——它们描述的是新闻，不是「有人想要一个工具」。
 * 这里改成从修饰词（generator / calculator / converter …）出发，只留下有真实搜索、
 * 难度不高的长尾词进入候选池。
 *
 * **词量只用于入口筛选，不进 D 轴**（06 §7.1a）：`external_demand_formed` 用第三方
 * 词量判定结果事件，D 轴若再读同一份词量就会自证。所以这里返回的 `searchVolume` /
 * `keywordDifficulty` 只决定「要不要观测」，绝不写进 `ScoringInput`。
 */

/** 单个种子一次请求的价格（2026-10-18 经 AIsa 实测 limit 50 为 $0.018）。 */
export const KEYWORD_SEED_COST_USD = 0.018;

export interface KeywordSeedFilter {
  /** 月搜索量下限。低于它的词观测了也大概率没有市场。 */
  minVolume: number;
  /** 月搜索量上限。太大的头部词不是单人一周能切入的长尾。 */
  maxVolume: number;
  /** DataForSEO keyword_difficulty（0–100）上限。 */
  maxDifficulty: number;
  /** 每个种子最多取回的条数。 */
  limit: number;
}

/**
 * 入口阈值。
 *
 * 这里曾经是 `minVolume: 200 / maxDifficulty: 30`，结果是候选池里全是月搜几百的词。
 * 原因是**把「我能不能赢」塞进了发现阶段**：难度与搜索量正相关，KD≤30 会系统性地
 * 把高需求词筛掉，只留下没人搜的长尾。
 *
 * 现在的口径：
 *   - 入口只按**需求**筛（`minVolume`），难度只作为记录信号，交给 W 轴判断；
 *   - `maxDifficulty` 仍然保留，但放到 60——低于这个值才有观测价值，
 *     不是"低于 30 才配被看见"；
 *   - 头部词用词数与意图过滤（2–6 词、非导航、非定义），不用搜索量上限硬砍。
 *
 * 数值可用环境变量覆盖，便于在不动代码的情况下做样本外对比。
 */
export const DEFAULT_KEYWORD_SEED_FILTER: KeywordSeedFilter = {
  minVolume: Number(process.env.SEED_MIN_VOLUME ?? 1000),
  maxVolume: Number(process.env.SEED_MAX_VOLUME ?? 100_000),
  maxDifficulty: Number(process.env.SEED_MAX_DIFFICULTY ?? 60),
  limit: Number(process.env.SEED_SUGGESTION_LIMIT ?? 100),
};

/** 需求分档：用于排序与展示，不参与评分（06 §7.1a）。 */
export function volumeBand(volume: number): '1K' | '5K' | '20K' | '100K+' {
  if (volume >= 100_000) return '100K+';
  if (volume >= 20_000) return '20K';
  if (volume >= 5_000) return '5K';
  return '1K';
}

export interface KeywordSuggestion {
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number | null;
  /** DataForSEO 的 main_intent（informational / commercial / transactional / navigational）。 */
  mainIntent: string | null;
}

/** 词量/难度/CPC 的批量核验结果（只用于入口与展示）。 */
export interface KeywordDemandDetail {
  keyword: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  competition: number | null;
  /** 逐月搜索量（historical_search_volume 才有；overview 通常为空）。 */
  monthlySearches: Array<{ year: number; month: number; searchVolume: number }>;
}

/** DataForSEO 的意图分类（估计，不是事实）。 */
export interface KeywordIntentDetail {
  keyword: string;
  label: string | null;
  probability: number | null;
  secondary: Array<{ label: string | null; probability: number | null }>;
}

export type KeywordSeedCredentials = { login: string; password: string } | { aisaApiKey: string };

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';
const AISA_DATAFORSEO_BASE = 'https://api.aisa.one/apis/v1/dataforseo';
const PATH = '/dataforseo_labs/google/keyword_suggestions/live';
/**
 * `keyword_ideas` 返回**相关词**，而不是“包含种子”的词。
 *
 * 这是量级差异的根源：`keyword_suggestions` 只能给 "invoice generator excel template"
 * 这类长尾（月搜几百），而 `keyword_ideas` 能给出 "invoice generator" 这种真正的
 * 商业词（月搜上万）。两者不是替代关系，是互补：一个给长尾覆盖，一个给需求上限。
 */
const IDEAS_PATH = '/dataforseo_labs/google/keyword_ideas/live';
/** 批量核验词量与难度（可用于验证供应商的估计是否自相矛盾）。 */
const OVERVIEW_PATH = '/dataforseo_labs/google/keyword_overview/live';
/** DataForSEO 自己的意图分类；只作交叉验证，不替代我们的 intent_fit。 */
const INTENT_PATH = '/dataforseo_labs/google/search_intent/live';
/** 12 个月逐月搜索量：唯一能替代“等 14 天”的需求趋势证据。 */
const HISTORY_PATH = '/dataforseo_labs/google/historical_search_volume/live';

/**
 * 解析 DataForSEO Labs 信封。拒绝也是 HTTP 200，结论在 `tasks[0].status_code`；
 * 形状不对返回 null，不猜、不补零。缺词量的条目丢掉，而不是当成 0。
 */
export function parseKeywordSuggestions(body: unknown): KeywordSuggestion[] | null {
  const task = (body as any)?.tasks?.[0];
  if (!task || task.status_code !== 20000) return null;
  const result = task.result?.[0];
  if (result === null || result === undefined) return [];
  if (!Array.isArray(result.items)) return null;
  const out: KeywordSuggestion[] = [];
  for (const item of result.items) {
    const keyword = typeof item?.keyword === 'string' ? item.keyword.trim() : '';
    const volume = item?.keyword_info?.search_volume;
    if (!keyword || typeof volume !== 'number' || volume < 0) continue;
    if (item?.keyword_properties?.is_another_language === true) continue;
    const kd = item?.keyword_properties?.keyword_difficulty;
    const intent = item?.search_intent_info?.main_intent;
    out.push({
      keyword,
      searchVolume: volume,
      keywordDifficulty: typeof kd === 'number' ? kd : null,
      mainIntent: typeof intent === 'string' ? intent : null,
    });
  }
  return out;
}

export class KeywordSeedCollector {
  constructor(
    private readonly creds: KeywordSeedCredentials,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /** 一个种子的相关词（更高需求上限）。失败返回 null，语义与 suggest 一致。 */
  async ideas(
    seed: string,
    filter: KeywordSeedFilter = DEFAULT_KEYWORD_SEED_FILTER,
    market: { locationCode?: number; languageCode?: string } = {}
  ): Promise<KeywordSuggestion[] | null> {
    return this.request(IDEAS_PATH, [seed], filter, market);
  }

  /** 一个种子的长尾词。网络错误、HTTP 非 2xx、任务被拒都返回 null。 */
  async suggest(
    seed: string,
    filter: KeywordSeedFilter = DEFAULT_KEYWORD_SEED_FILTER,
    market: { locationCode?: number; languageCode?: string } = {}
  ): Promise<KeywordSuggestion[] | null> {
    return this.request(PATH, [seed], filter, market);
  }

  /**
   * 共用请求体。两个端点（suggestions / ideas）的信封与条目形状一致，
   * 差异只在 `keywords` 的语义与返回集合，所以只保留一份实现。
   */
  private async request(
    path: string,
    keywords: string[],
    filter: KeywordSeedFilter,
    market: { locationCode?: number; languageCode?: string }
  ): Promise<KeywordSuggestion[] | null> {
    // 两个端点的入参字段不同：suggestions 收单数 `keyword`，ideas 收复数 `keywords`。
    // 传错字段 API 不报错，只是返回空集合——那会把“没取到”伪装成“没这个词”。
    const seedField = path === PATH ? { keyword: keywords[0] } : { keywords };
    const [base, authorization] = 'aisaApiKey' in this.creds
      ? [AISA_DATAFORSEO_BASE, `Bearer ${this.creds.aisaApiKey}`]
      : [DATAFORSEO_BASE, `Basic ${Buffer.from(`${this.creds.login}:${this.creds.password}`).toString('base64')}`];
    try {
      const res = await this.fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            ...seedField,
            location_code: market.locationCode ?? 2840,
            language_code: market.languageCode ?? 'en',
            limit: filter.limit,
            // 相关性筛选只在入口用；词量绝不进评分（06 §7.1a）。
            filters: [
              ['keyword_info.search_volume', '>=', filter.minVolume],
              'and',
              ['keyword_info.search_volume', '<=', filter.maxVolume],
            ],
            order_by: ['keyword_info.search_volume,desc'],
          },
        ]),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return null;
      return parseKeywordSuggestions(await res.json());
    } catch {
      return null;
    }
  }

  /**
   * 批量核验：词量、难度、CPC。
   *
   * 用途是**验证**而不是发现——同一批词在 suggestions / ideas / overview 里
   * 出现不同搜索量时，至少能看出来供应商自己的估计不一致。
   */
  async overview(
    keywords: string[],
    market: { locationCode?: number; languageCode?: string } = {}
  ): Promise<KeywordDemandDetail[] | null> {
    return this.batch(OVERVIEW_PATH, keywords, market, (item) => ({
      keyword: String(item?.keyword ?? ''),
      searchVolume: numberOrNull(item?.keyword_info?.search_volume),
      keywordDifficulty: numberOrNull(item?.keyword_properties?.keyword_difficulty),
      cpc: numberOrNull(item?.keyword_info?.cpc),
      competition: numberOrNull(item?.keyword_info?.competition),
      monthlySearches: parseMonthly(item?.keyword_info?.monthly_searches),
    }));
  }

  /**
   * 12 个月逐月搜索量。
   *
   * 这是**需求侧最强的外部证据**，但只能用于入口排序与研报叙述：
   * D 轴读它就会与 `external_demand_formed` 的事件判据自证（06 §7.1a）。
   */
  async history(
    keywords: string[],
    market: { locationCode?: number; languageCode?: string } = {}
  ): Promise<KeywordDemandDetail[] | null> {
    return this.batch(HISTORY_PATH, keywords, market, (item) => ({
      keyword: String(item?.keyword ?? ''),
      searchVolume: numberOrNull(item?.keyword_info?.search_volume),
      keywordDifficulty: numberOrNull(item?.keyword_properties?.keyword_difficulty),
      cpc: numberOrNull(item?.keyword_info?.cpc),
      competition: numberOrNull(item?.keyword_info?.competition),
      monthlySearches: parseMonthly(item?.keyword_info?.monthly_searches),
    }));
  }

  /**
   * DataForSEO 的意图分类。
   *
   * 它也是**估计**，不是事实：`podcast transcript seo` 被打成 transactional
   * 不代表用户想买。所以我们只把它当交叉验证信号，判据仍以 SERP 形态为准。
   */
  async intent(keywords: string[]): Promise<KeywordIntentDetail[] | null> {
    try {
      const [base, authorization] = this.auth();
      const res = await this.fetchImpl(`${base}${INTENT_PATH}`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ keywords }]),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const rows = itemsOf(await res.json());
      if (!rows) return null;
      return rows.map((item: any) => ({
        keyword: String(item?.keyword ?? ''),
        label: typeof item?.keyword_intent?.label === 'string' ? item.keyword_intent.label : null,
        probability: numberOrNull(item?.keyword_intent?.probability),
        secondary: Array.isArray(item?.secondary_keyword_intents)
          ? item.secondary_keyword_intents.map((row: any) => ({
              label: typeof row?.label === 'string' ? row.label : null,
              probability: numberOrNull(row?.probability),
            }))
          : [],
      }));
    } catch {
      return null;
    }
  }

  private auth(): [string, string] {
    return 'aisaApiKey' in this.creds
      ? [AISA_DATAFORSEO_BASE, `Bearer ${this.creds.aisaApiKey}`]
      : [DATAFORSEO_BASE, `Basic ${Buffer.from(`${this.creds.login}:${this.creds.password}`).toString('base64')}`];
  }

  /** 批量端点的公共外壳：POST 数组 body，按 `itemsOf` 取条目。 */
  private async batch<T>(
    path: string,
    keywords: string[],
    market: { locationCode?: number; languageCode?: string },
    map: (item: any) => T
  ): Promise<T[] | null> {
    if (keywords.length === 0) return [];
    try {
      const [base, authorization] = this.auth();
      const res = await this.fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            keywords: keywords.slice(0, 1000),
            location_code: market.locationCode ?? 2840,
            language_code: market.languageCode ?? 'en',
          },
        ]),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return null;
      const rows = itemsOf(await res.json());
      if (!rows) return null;
      return rows.map(map);
    } catch {
      return null;
    }
  }
}

function itemsOf(body: unknown): any[] | null {
  const task = (body as any)?.tasks?.[0];
  if (!task || task.status_code !== 20000) return null;
  const result = task.result?.[0];
  if (result === null || result === undefined) return [];
  if (!Array.isArray(result.items)) return null;
  return result.items;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseMonthly(value: unknown): Array<{ year: number; month: number; searchVolume: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((row: any) => ({
      year: Number(row?.year),
      month: Number(row?.month),
      searchVolume: Number(row?.search_volume),
    }))
    .filter((row) => Number.isFinite(row.year) && Number.isFinite(row.month) && Number.isFinite(row.searchVolume));
}
