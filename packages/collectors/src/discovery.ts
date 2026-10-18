import { createHash } from 'node:crypto';
import { DiscoveryFailure, DiscoveryItem, DiscoveryResult } from './types';

export interface DiscoverySource {
  readonly sourceId: string;
  readonly provider: string;
  discover(): Promise<DiscoveryResult | DiscoveryFailure>;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function requestHash(url: string, headers: Record<string, string> = {}): string {
  return sha256(JSON.stringify({ url, headers }));
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function xmlTag(block: string, name: string): string | undefined {
  const value = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1];
  return value ? decodeXml(value) : undefined;
}

export class HackerNewsDiscoverySource implements DiscoverySource {
  readonly sourceId = 'src_hackernews';
  readonly provider = 'HACKER_NEWS_API';
  private readonly baseUrl = 'https://hacker-news.firebaseio.com/v0';

  async discover(): Promise<DiscoveryResult | DiscoveryFailure> {
    const listUrl = `${this.baseUrl}/newstories.json`;
    try {
      const listResponse = await fetch(listUrl, { signal: AbortSignal.timeout(10000) });
      if (!listResponse.ok) throw new Error(`Hacker News returned ${listResponse.status}`);
      const ids = (await listResponse.json()) as unknown;
      if (!Array.isArray(ids)) throw new Error('Hacker News returned an invalid story list');
      const stories = await Promise.all(
        ids.slice(0, 20).map(async (id) => {
          const response = await fetch(`${this.baseUrl}/item/${id}.json`, {
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) return null;
          const item = (await response.json()) as Record<string, unknown>;
          if (item.type !== 'story' || typeof item.title !== 'string' || typeof item.url !== 'string') return null;
          const collectedAt = new Date();
          const canonical = JSON.stringify({ id, title: item.title, url: item.url, text: item.text ?? null });
          const entry: DiscoveryItem = {
            sourceItemId: String(id),
            provider: this.provider,
            sourceUrl: item.url,
            title: item.title,
            excerpt: typeof item.text === 'string' ? item.text.slice(0, 500) : undefined,
            publishedAt: typeof item.time === 'number' ? new Date(item.time * 1000) : undefined,
            collectedAt,
            contentHash: sha256(canonical),
            requestHash: requestHash(`${this.baseUrl}/item/${id}.json`),
            metadata: { hnUrl: `https://news.ycombinator.com/item?id=${id}`, score: item.score, descendants: item.descendants },
          };
          return entry;
        }),
      );
      const items = stories.filter((item): item is DiscoveryItem => item !== null);
      const rawContent = JSON.stringify({ source: this.provider, listUrl, items });
      return {
        status: 'OK',
        items,
        raw: { content: rawContent, contentHash: sha256(rawContent), mimeType: 'application/json' },
        cost: { sourceId: this.sourceId, costUsd: 0, category: 'INFRA', units: items.length },
      };
    } catch (error) {
      return { status: 'FAILED', retryable: true, errorCode: 'HN_FETCH_ERROR', message: (error as Error).message };
    }
  }
}

export class RssDiscoverySource implements DiscoverySource {
  readonly sourceId: string;
  readonly provider = 'RSS';
  constructor(private readonly feedUrl: string, private readonly name: string) {
    this.sourceId = `src_rss_${sha256(feedUrl).slice(0, 12)}`;
  }

  async discover(): Promise<DiscoveryResult | DiscoveryFailure> {
    try {
      const response = await fetch(this.feedUrl, {
        headers: { 'User-Agent': 'EmeRadar/1.0 discovery; +https://emeradar.com' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`${this.name} RSS returned ${response.status}`);
      const xml = await response.text();
      const items: DiscoveryItem[] = [];
      for (const block of xml.match(/<item[\s\S]*?<\/item>/g) ?? []) {
        const title = xmlTag(block, 'title');
        const sourceUrl = xmlTag(block, 'link') ?? xmlTag(block, 'guid');
        if (!title || !sourceUrl || !/^https?:\/\//i.test(sourceUrl)) continue;
        const published = xmlTag(block, 'pubDate') ?? xmlTag(block, 'published') ?? xmlTag(block, 'updated');
        const excerpt = xmlTag(block, 'description')?.slice(0, 500);
        const canonical = JSON.stringify({ title, sourceUrl, excerpt, published });
        items.push({
          sourceItemId: sha256(sourceUrl), provider: this.provider, sourceUrl, title, excerpt,
          publishedAt: published ? new Date(published) : undefined, collectedAt: new Date(),
          contentHash: sha256(canonical), requestHash: requestHash(this.feedUrl), metadata: { feed: this.feedUrl },
        });
      }
      const rawContent = JSON.stringify({ source: this.provider, feedUrl: this.feedUrl, items });
      return { status: 'OK', items, raw: { content: rawContent, contentHash: sha256(rawContent), mimeType: 'application/xml' }, cost: { sourceId: this.sourceId, costUsd: 0, category: 'INFRA', units: items.length } };
    } catch (error) {
      return { status: 'FAILED', retryable: true, errorCode: 'RSS_FETCH_ERROR', message: (error as Error).message };
    }
  }
}

/**
 * AIsa 多源搜索（`GET /apis/v1/search/smart`）。
 *
 * 注意两件事：
 *   1. 这是 AIsa 聚合的**多源网页搜索**，不是 Google SERP；只能用于 discovery，
 *      不能进 W 轴。SERP 仍走 `serp-collector` 的 DataForSEO/SerpAPI 路径。
 *   2. 搜索必须带 `q`。旧实现 POST `{}` 到 Tavily 端点，只会拿到 422，这是它
 *      长期 FAILED 0 items 的原因。
 *
 * discovery 本身没有输入，所以种子查询必须显式配置（`AISA_SEARCH_QUERIES`，
 * 逗号或换行分隔）。没有配置时不要注册这个源——不要每天跑一个必然失败的任务。
 */
export class AIsaSearchDiscoverySource implements DiscoverySource {
  readonly sourceId = 'src_aisa_search';
  readonly provider = 'AISA_SEARCH';

  constructor(
    private readonly queries: string[],
    private readonly apiKey = process.env.AISA_API_KEY,
    private readonly endpoint = 'https://api.aisa.one/apis/v1/search/smart',
    private readonly count = 10,
    private readonly costPerRequestUsd = 0.001
  ) {}

  async discover(): Promise<DiscoveryResult | DiscoveryFailure> {
    if (!this.apiKey) {
      return {
        status: 'FAILED',
        retryable: false,
        errorCode: 'AISA_NOT_CONFIGURED',
        message: 'AISA_API_KEY is not configured.',
      };
    }
    if (this.queries.length === 0) {
      return {
        status: 'FAILED',
        retryable: false,
        errorCode: 'AISA_NO_QUERIES',
        message: 'AISA_SEARCH_QUERIES is empty; refusing to search without a query.',
      };
    }

    const items: DiscoveryItem[] = [];
    const seen = new Set<string>();
    const rawPayloads: unknown[] = [];
    let requests = 0;

    try {
      for (const query of this.queries.slice(0, 10)) {
        const url = new URL(this.endpoint);
        url.searchParams.set('q', query);
        url.searchParams.set('count', String(this.count));
        const response = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) {
          throw new Error(`AIsa Smart Search returned ${response.status} for "${query}"`);
        }
        requests++;
        const payload = (await response.json()) as any;
        rawPayloads.push(payload);
        const rows = payload?.webPages?.value;
        if (!Array.isArray(rows)) {
          throw new Error('AIsa Smart Search response does not expose webPages.value[]');
        }
        for (const row of rows) {
          const sourceUrl = typeof row?.url === 'string' ? row.url : null;
          const title = typeof row?.name === 'string' ? row.name : null;
          if (!sourceUrl || !title || !/^https?:\/\//i.test(sourceUrl)) continue;
          if (seen.has(sourceUrl)) continue;
          seen.add(sourceUrl);
          const excerpt =
            typeof row?.snippet === 'string' && row.snippet.trim().length > 0
              ? row.snippet.slice(0, 500)
              : typeof row?.content === 'string'
              ? row.content.slice(0, 500)
              : undefined;
          const publishedAt =
            typeof row?.datePublished === 'string' && !Number.isNaN(Date.parse(row.datePublished))
              ? new Date(row.datePublished)
              : undefined;
          const canonical = JSON.stringify({
            url: sourceUrl,
            title,
            excerpt: excerpt ?? null,
            publishedAt: publishedAt?.toISOString() ?? null,
          });
          items.push({
            sourceItemId: sha256(sourceUrl),
            provider: this.provider,
            sourceUrl,
            title,
            excerpt,
            publishedAt,
            collectedAt: new Date(),
            contentHash: sha256(canonical),
            requestHash: requestHash(url.toString()),
            metadata: {
              query,
              score: typeof row?.score === 'number' ? row.score : undefined,
              siteName: typeof row?.siteName === 'string' ? row.siteName : undefined,
            },
          });
        }
      }
    } catch (error) {
      return {
        status: 'FAILED',
        retryable: true,
        errorCode: 'AISA_SEARCH_ERROR',
        message: (error as Error).message,
      };
    }

    const rawContent = JSON.stringify({ source: this.provider, queries: this.queries, payloads: rawPayloads });
    return {
      status: 'OK',
      items,
      raw: { content: rawContent, contentHash: sha256(rawContent), mimeType: 'application/json' },
      cost: {
        sourceId: this.sourceId,
        costUsd: Math.round(requests * this.costPerRequestUsd * 1e6) / 1e6,
        category: 'INFRA',
        units: requests,
      },
    };
  }
}

/**
 * AnySearch 统一搜索（`POST https://api.anysearch.com/v1/search`）。
 *
 * 和 AIsa Smart Search 一样，这是多源网页搜索，不是 Google SERP；只能用于
 * discovery / Why Now，不能进 W 轴。响应形状：
 * `{ code: 0, data: { results: [{ title, url, snippet?, content? }] } }`。
 *
 * 匿名访问有每日免费额度但按 IP 限流；生产默认要求 `ANYSEARCH_API_KEY`，
 * 只有显式 `ANYSEARCH_ALLOW_ANONYMOUS=true` 才允许无 key 运行。
 * 种子查询来自 `ANYSEARCH_QUERIES`，未配置时回退 `AISA_SEARCH_QUERIES`。
 */
export class AnySearchDiscoverySource implements DiscoverySource {
  readonly sourceId = 'src_anysearch';
  readonly provider = 'ANYSEARCH';

  constructor(
    private readonly queries: string[],
    private readonly apiKey = process.env.ANYSEARCH_API_KEY,
    private readonly endpoint = 'https://api.anysearch.com/v1/search',
    private readonly maxResults = 10
  ) {}

  async discover(): Promise<DiscoveryResult | DiscoveryFailure> {
    if (!this.apiKey && process.env.ANYSEARCH_ALLOW_ANONYMOUS !== 'true') {
      return {
        status: 'FAILED',
        retryable: false,
        errorCode: 'ANYSEARCH_NOT_CONFIGURED',
        message: 'ANYSEARCH_API_KEY is required unless ANYSEARCH_ALLOW_ANONYMOUS=true.',
      };
    }
    if (this.queries.length === 0) {
      return {
        status: 'FAILED',
        retryable: false,
        errorCode: 'ANYSEARCH_NO_QUERIES',
        message: 'ANYSEARCH_QUERIES is empty; refusing to search without a query.',
      };
    }

    const items: DiscoveryItem[] = [];
    const seen = new Set<string>();
    const rawPayloads: unknown[] = [];
    let requests = 0;

    try {
      for (const query of this.queries.slice(0, 10)) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query,
            max_results: Math.min(10, Math.max(1, this.maxResults)),
            zone: 'intl',
            language: 'en',
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          throw new Error(`AnySearch returned ${response.status} for "${query}"`);
        }
        requests++;
        const payload = (await response.json()) as any;
        rawPayloads.push(payload);
        if (payload?.code !== 0) {
          throw new Error(`AnySearch business error ${payload?.code ?? 'unknown'}: ${payload?.message ?? ''}`);
        }
        const rows = payload?.data?.results;
        if (!Array.isArray(rows)) {
          throw new Error('AnySearch response does not expose data.results[]');
        }
        for (const row of rows) {
          const sourceUrl = typeof row?.url === 'string' ? row.url : null;
          if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) continue;
          if (seen.has(sourceUrl)) continue;
          seen.add(sourceUrl);
          const title =
            typeof row?.title === 'string' && row.title.trim().length > 0
              ? row.title.trim()
              : sourceUrl;
          const excerpt =
            typeof row?.snippet === 'string' && row.snippet.trim().length > 0
              ? row.snippet.slice(0, 500)
              : typeof row?.content === 'string'
              ? row.content.slice(0, 500)
              : undefined;
          const canonical = JSON.stringify({ url: sourceUrl, title, excerpt: excerpt ?? null });
          items.push({
            sourceItemId: sha256(sourceUrl),
            provider: this.provider,
            sourceUrl,
            title,
            excerpt,
            collectedAt: new Date(),
            contentHash: sha256(canonical),
            requestHash: requestHash(this.endpoint),
            metadata: { query },
          });
        }
      }
    } catch (error) {
      return {
        status: 'FAILED',
        retryable: true,
        errorCode: 'ANYSEARCH_ERROR',
        message: (error as Error).message,
      };
    }

    const rawContent = JSON.stringify({ source: this.provider, queries: this.queries, payloads: rawPayloads });
    return {
      status: 'OK',
      items,
      raw: { content: rawContent, contentHash: sha256(rawContent), mimeType: 'application/json' },
      cost: {
        sourceId: this.sourceId,
        costUsd: 0,
        category: 'INFRA',
        units: requests,
      },
    };
  }
}
