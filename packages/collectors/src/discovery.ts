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

export class AIsaSearchProvider implements DiscoverySource {
  readonly sourceId = 'src_aisa_search';
  readonly provider = 'AISA_SEARCH';

  constructor(
    private readonly endpoint = process.env.AISA_SEARCH_URL,
    private readonly apiKey = process.env.AISA_API_KEY,
  ) {}

  async discover(): Promise<DiscoveryResult | DiscoveryFailure> {
    if (!this.endpoint || !this.apiKey) {
      return { status: 'FAILED', retryable: false, errorCode: 'AISA_NOT_CONFIGURED', message: 'AIsa Search endpoint and key are not configured.' };
    }
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`AIsa Search returned ${response.status}`);
      const payload = (await response.json()) as any;
      if (!Array.isArray(payload?.items)) {
        return { status: 'FAILED', retryable: false, errorCode: 'AISA_SCHEMA_UNSUPPORTED', message: 'AIsa response does not expose the required items array; provider remains disabled.' };
      }
      const collectedAt = new Date();
      const items: DiscoveryItem[] = [];
      for (const raw of payload.items.slice(0, 50)) {
        if (typeof raw?.url !== 'string' || typeof raw?.title !== 'string') continue;
        const canonical = JSON.stringify({ url: raw.url, title: raw.title, excerpt: raw.excerpt ?? raw.snippet ?? null, publishedAt: raw.publishedAt ?? null });
        items.push({
          sourceItemId: typeof raw.id === 'string' ? raw.id : sha256(raw.url),
          provider: this.provider,
          sourceUrl: raw.url,
          title: raw.title,
          excerpt: typeof (raw.excerpt ?? raw.snippet) === 'string' ? String(raw.excerpt ?? raw.snippet).slice(0, 500) : undefined,
          publishedAt: typeof raw.publishedAt === 'string' ? new Date(raw.publishedAt) : undefined,
          collectedAt,
          contentHash: sha256(canonical),
          requestHash: requestHash(this.endpoint, { authorization: 'Bearer [redacted]' }),
          metadata: { provider: this.provider },
        });
      }
      const rawContent = JSON.stringify({ provider: this.provider, items });
      return { status: 'OK', items, raw: { content: rawContent, contentHash: sha256(rawContent), mimeType: 'application/json' }, cost: { sourceId: this.sourceId, costUsd: 0, category: 'INFRA', units: items.length } };
    } catch (error) {
      return { status: 'FAILED', retryable: true, errorCode: 'AISA_FETCH_ERROR', message: (error as Error).message };
    }
  }
}
