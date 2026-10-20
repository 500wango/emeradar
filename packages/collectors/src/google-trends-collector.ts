import { readBodyWithLimit } from '@emeradar/core';

/**
 * Google Trends（经 DataForSEO `keywords_data/google_trends/explore/live`）。
 *
 * 用途：给扫码结果补上「热度在涨还是在跌」。
 *
 * **不进评分。** D 轴只读 autocomplete 观测，读第三方热度会与
 * `external_demand_formed` 的事件判据自证（06 §7.1a）。这里的数据只用于展示与
 * 排序，标 `THIRD_PARTY_ESTIMATE`。
 *
 * 归一化口径：Google Trends 返回的是 0–100 的相对热度，不是搜索量。
 * 所以只能比“自己跟自己”的方向，不能跨词比大小。
 */
export const TRENDS_ENDPOINT =
  'https://api.aisa.one/apis/v1/dataforseo/keywords_data/google_trends/explore/live';

/** 90 天：日粒度。 */
export const TRENDS_WINDOW_90D = 'today 3-m';
/** 12 个月：周粒度（Google 在一年窗口上不给日粒度）。 */
export const TRENDS_WINDOW_12M = 'today 12-m';

export interface TrendsPoint {
  /** `YYYY-MM-DD`（区间起点）。 */
  date: string;
  /** 0–100 相对热度。 */
  value: number;
}

export interface TrendsSeries {
  window: string;
  points: TrendsPoint[];
  /** 窗口内均值（0–100）。 */
  average: number | null;
  /** 后半段均值 vs 前半段均值的变化率；-1..1 而不是百分比。 */
  change: number | null;
  /** 峰值点。 */
  peak: TrendsPoint | null;
}

export interface TrendsResult {
  keyword: string;
  ninetyDays: TrendsSeries | null;
  twelveMonths: TrendsSeries | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 解析 Google Trends 信封。
 *
 * 拒绝也是 HTTP 200，结论在 `tasks[0].status_code`；形状不对返回 null，不猜、不补零。
 * `missing_data=true` 的点直接丢弃：Google 用虚线表示“没有数据”，
 * 把它当 0 会把缺失读成“没人搜”。
 */
export function parseTrendsSeries(body: unknown, window: string): TrendsSeries | null {
  const task = (body as any)?.tasks?.[0];
  if (!task || task.status_code !== 20000) return null;
  const result = task.result?.[0];
  if (result === null || result === undefined) return { window, points: [], average: null, change: null, peak: null };
  const items = result.items;
  if (!Array.isArray(items)) return null;

  const graph = items.find((item: any) => item?.type === 'google_trends_graph') ?? items[0];
  const data = graph?.data;
  if (!Array.isArray(data)) return null;

  const points: TrendsPoint[] = [];
  for (const row of data) {
    if (row?.missing_data === true) continue;
    const date = String(row?.date_from ?? '').slice(0, 10);
    const value = Array.isArray(row?.values) ? Number(row.values[0]) : NaN;
    if (!DATE_RE.test(date) || !Number.isFinite(value)) continue;
    points.push({ date, value });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));

  if (points.length === 0) {
    return { window, points, average: null, change: null, peak: null };
  }

  const average = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  const half = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, half);
  const secondHalf = points.slice(points.length - half);
  const mean = (rows: TrendsPoint[]) => rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  const firstMean = half > 0 ? mean(firstHalf) : 0;
  const secondMean = half > 0 ? mean(secondHalf) : 0;
  // 前半段为 0 时不给变化率：0 → X 的相对变化没有意义。
  const change = half > 0 && firstMean > 0 ? (secondMean - firstMean) / firstMean : null;

  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0]);

  return {
    window,
    points,
    average: Math.round(average * 10) / 10,
    change: change === null ? null : Math.round(change * 1000) / 1000,
    peak,
  };
}

export class GoogleTrendsCollector {
  readonly sourceId = 'src_google_trends';

  constructor(
    private readonly apiKey = process.env.AISA_API_KEY,
    private readonly endpoint = TRENDS_ENDPOINT,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /** 一次请求取一个窗口。失败返回 null（不是空序列）。 */
  async collect(
    keyword: string,
    window: string,
    market: { locationCode?: number; languageCode?: string } = {}
  ): Promise<TrendsSeries | null> {
    if (!this.apiKey) return null;
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            keywords: [keyword],
            time_range: window,
            location_code: market.locationCode ?? 2840,
            language_code: market.languageCode ?? 'en',
          },
        ]),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return null;
      // 复用统一的大小上限，避免异常响应把进程内存吃满。
      const body = JSON.parse(await readBodyWithLimit(res));
      return parseTrendsSeries(body, window);
    } catch {
      return null;
    }
  }

  /** 90 天 + 12 个月两个窗口并发取。任一路失败不影响另一路。 */
  async collectBoth(
    keyword: string,
    market: { locationCode?: number; languageCode?: string } = {}
  ): Promise<TrendsResult> {
    const [ninetyDays, twelveMonths] = await Promise.all([
      this.collect(keyword, TRENDS_WINDOW_90D, market).catch(() => null),
      this.collect(keyword, TRENDS_WINDOW_12M, market).catch(() => null),
    ]);
    return { keyword, ninetyDays, twelveMonths };
  }
}
