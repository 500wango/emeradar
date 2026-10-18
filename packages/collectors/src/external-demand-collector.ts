/**
 * ev-1.1 外部结果事件的数据采集（06 §7.1a；04 `src_volume` / `src_trends`）。
 *
 * 供应商：DataForSEO（Google Ads 搜索量 + Google Trends explore）。按请求计费、单次最多
 * 1000 个词，所以调用方应批量传入。这里只做两件事：发请求，把响应解析成
 * `{ date, value }[]`。解析严格校验形状，任何一处对不上都返回 null，不猜、不补零。
 *
 * 两条通道，同一套请求体与响应信封：直连 DataForSEO（Basic 认证），或经 AIsa 代理
 * （`https://api.aisa.one/apis/v1/dataforseo` + Bearer，路径与直连 `/v3` 下一致）。
 * 2026-10-18 经 AIsa 实测两个端点均返回 `status_code 20000`，形状与下面的解析器一致：
 * 搜索量 $0.09/次（与词数无关），Trends $0.011/次。04 §7 第 7 项（100 条抽样核对）仍未做。
 */

export interface SeriesPoint {
  /** YYYY-MM-DD。词量按月，取该月 1 日；Trends 取周起始日。 */
  date: string;
  value: number;
}

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';
const AISA_DATAFORSEO_BASE = 'https://api.aisa.one/apis/v1/dataforseo';
const US_LOCATION = 2840;

/** 直连 DataForSEO 用账号密码；经 AIsa 用它的 API key。 */
export type ExternalDemandCredentials =
  | { login: string; password: string }
  | { aisaApiKey: string };

/** 直连凭证优先（成本更低）；没有就退到 AIsa；都没有返回 null，任务整体跳过。 */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): ExternalDemandCredentials | null {
  const login = env.DATAFORSEO_LOGIN;
  const password = env.DATAFORSEO_PASSWORD;
  if (login && password) return { login, password };
  return env.AISA_API_KEY ? { aisaApiKey: env.AISA_API_KEY } : null;
}

/** 解析 Google Ads 搜索量响应：keyword → 最近各月的搜索量。形状不对返回 null。 */
export function parseVolumeResponse(body: unknown): Map<string, SeriesPoint[]> | null {
  const task = (body as any)?.tasks?.[0];
  if (!task || task.status_code !== 20000 || !Array.isArray(task.result)) return null;
  const out = new Map<string, SeriesPoint[]>();
  for (const row of task.result) {
    if (typeof row?.keyword !== 'string') return null;
    const months = Array.isArray(row.monthly_searches) ? row.monthly_searches : [];
    const points: SeriesPoint[] = [];
    for (const m of months) {
      if (!Number.isInteger(m?.year) || !Number.isInteger(m?.month) || typeof m?.search_volume !== 'number') continue;
      if (m.month < 1 || m.month > 12 || m.search_volume < 0) continue;
      points.push({ date: `${m.year}-${String(m.month).padStart(2, '0')}-01`, value: m.search_volume });
    }
    out.set(row.keyword, points);
  }
  return out;
}

/** 解析 Trends explore 响应的兴趣随时间序列（相对值 0–100）。形状不对返回 null。 */
export function parseTrendsResponse(body: unknown): SeriesPoint[] | null {
  const task = (body as any)?.tasks?.[0];
  if (!task || task.status_code !== 20000) return null;
  const items = task.result?.[0]?.items;
  if (!Array.isArray(items)) return null;
  const graph = items.find((i: any) => i?.type === 'google_trends_graph');
  if (!graph || !Array.isArray(graph.data)) return null;
  const points: SeriesPoint[] = [];
  for (const d of graph.data) {
    const value = Array.isArray(d?.values) ? d.values[0] : null;
    if (typeof d?.date_from !== 'string' || typeof value !== 'number' || value < 0) continue;
    points.push({ date: d.date_from, value });
  }
  return points;
}

export class ExternalDemandCollector {
  constructor(
    private readonly creds: ExternalDemandCredentials,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async post(path: string, payload: unknown): Promise<unknown | null> {
    const [base, authorization] = 'aisaApiKey' in this.creds
      ? [AISA_DATAFORSEO_BASE, `Bearer ${this.creds.aisaApiKey}`]
      : [DATAFORSEO_BASE, `Basic ${Buffer.from(`${this.creds.login}:${this.creds.password}`).toString('base64')}`];
    try {
      const res = await this.fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /** 一次请求拿多个词的月度搜索量（单次最多 1000 词，同价）。 */
  async fetchVolume(keywords: string[]): Promise<Map<string, SeriesPoint[]> | null> {
    if (keywords.length === 0) return new Map();
    const body = await this.post('/keywords_data/google_ads/search_volume/live', [
      { keywords: keywords.slice(0, 1000), location_code: US_LOCATION, language_code: 'en' },
    ]);
    return body ? parseVolumeResponse(body) : null;
  }

  /**
   * 单个词在 [dateFrom, dateTo] 的 Trends 序列。Trends 的值在**同一次请求内**归一化到
   * 0–100，跨请求不可比，所以调用方每次都重取整个区间并整段覆盖，评估时读到的所有点
   * 都来自同一次请求。
   */
  async fetchTrends(keyword: string, dateFrom: string, dateTo: string): Promise<SeriesPoint[] | null> {
    const body = await this.post('/keywords_data/google_trends/explore/live', [
      { keywords: [keyword], location_code: US_LOCATION, date_from: dateFrom, date_to: dateTo, type: 'web' },
    ]);
    return body ? parseTrendsResponse(body) : null;
  }
}
