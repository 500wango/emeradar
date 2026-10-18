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

export const DEFAULT_KEYWORD_SEED_FILTER: KeywordSeedFilter = {
  minVolume: 200,
  maxVolume: 20000,
  maxDifficulty: 30,
  limit: 50,
};

export interface KeywordSuggestion {
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number | null;
  /** DataForSEO 的 main_intent（informational / commercial / transactional / navigational）。 */
  mainIntent: string | null;
}

export type KeywordSeedCredentials = { login: string; password: string } | { aisaApiKey: string };

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';
const AISA_DATAFORSEO_BASE = 'https://api.aisa.one/apis/v1/dataforseo';
const PATH = '/dataforseo_labs/google/keyword_suggestions/live';

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

  /** 一个种子的长尾词。网络错误、HTTP 非 2xx、任务被拒都返回 null。 */
  async suggest(
    seed: string,
    filter: KeywordSeedFilter = DEFAULT_KEYWORD_SEED_FILTER,
    market: { locationCode?: number; languageCode?: string } = {}
  ): Promise<KeywordSuggestion[] | null> {
    const [base, authorization] = 'aisaApiKey' in this.creds
      ? [AISA_DATAFORSEO_BASE, `Bearer ${this.creds.aisaApiKey}`]
      : [DATAFORSEO_BASE, `Basic ${Buffer.from(`${this.creds.login}:${this.creds.password}`).toString('base64')}`];
    try {
      const res = await this.fetchImpl(`${base}${PATH}`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            keyword: seed,
            location_code: market.locationCode ?? 2840,
            language_code: market.languageCode ?? 'en',
            limit: filter.limit,
            filters: [
              ['keyword_info.search_volume', '>=', filter.minVolume],
              'and',
              ['keyword_info.search_volume', '<=', filter.maxVolume],
              'and',
              ['keyword_properties.keyword_difficulty', '<=', filter.maxDifficulty],
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
}
