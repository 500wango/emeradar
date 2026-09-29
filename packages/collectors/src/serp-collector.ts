import { createHash } from 'node:crypto';
import { calculateSerpWeakness, ResultType, SerpItemInput } from '@emeradar/scoring';
import {
  Collector,
  CollectOutcome,
  RunContext,
  PlannedBatch,
  SnapshotDraft,
  EvidenceDraft,
} from './types';

export interface SerpTarget {
  queryId: string;
  queryText: string;
  opportunityId?: string;
  marketCountry?: string;
  researchLanguage?: string;
}

export interface SerpCollectedItem {
  rank: number;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  resultType: ResultType;
  domainAuthorityClass: string;
  isWeak: boolean;
  weaknessType?: string;
  publishedAt?: Date;
}

export class SerpCollector implements Collector<SerpTarget[], SerpTarget> {
  readonly sourceId = 'src_serp';
  readonly version = '1.0.0';
  readonly limits = {
    maxConcurrency: 2,
    ratePerSecond: 2,
  };

  private costPerQueryUsd = 0.003; // ~$3.00 per 1,000 SERP queries

  async plan(
    ctx: RunContext,
    scope: SerpTarget[]
  ): Promise<PlannedBatch<SerpTarget>> {
    const estimatedCost = scope.length * this.costPerQueryUsd;
    return {
      batchId: `batch_serp_${ctx.obsDate}_${Date.now()}`,
      items: scope,
      estimatedCostUsd: Math.round(estimatedCost * 10000) / 10000,
    };
  }

  async collect(ctx: RunContext, item: SerpTarget): Promise<CollectOutcome> {
    // 1. Check budget guard
    if (!ctx.budget.canSpend(this.costPerQueryUsd)) {
      return {
        status: 'SKIPPED',
        reason: 'BUDGET',
      };
    }

    try {
      const rawItems = await this.fetchSerp(
        item.queryText,
        item.marketCountry || 'US',
        item.researchLanguage || 'en'
      );
      if (!rawItems || rawItems.length === 0) {
        return {
          status: 'FAILED',
          retryable: true,
          errorCode: 'SERP_UNAVAILABLE',
          message:
            'No organic SERP provider returned results. Set SERP_API_KEY (SerpAPI) or BRAVE_API_KEY. A failed fetch is not scored.',
        };
      }

      // 3. Classify and evaluate weakness
      const scoredInput: SerpItemInput[] = rawItems.map((raw) => ({
        rank: raw.rank,
        url: raw.url,
        domain: raw.domain,
        title: raw.title,
        resultType: raw.resultType,
        ageDays: raw.ageDays,
      }));

      const weaknessResult = calculateSerpWeakness(scoredInput);

      const items: SerpCollectedItem[] = rawItems.map((raw, idx) => {
        const scored = weaknessResult.items[idx];
        return {
          rank: raw.rank,
          url: raw.url,
          domain: raw.domain,
          title: raw.title,
          snippet: raw.snippet,
          resultType: raw.resultType,
          domainAuthorityClass: this.classifyDomainAuthority(raw.domain),
          isWeak: scored ? scored.isWeak : false,
          weaknessType: scored ? scored.weaknessType : undefined,
          publishedAt: raw.publishedAt,
        };
      });

      const weakRatio =
        items.length > 0
          ? Math.round((weaknessResult.weakCount / items.length) * 10000) / 10000
          : 0;

      // 4. Assemble Draft Snapshot
      const snapshotId = `srp_${item.queryId}_${ctx.obsDate.replace(/-/g, '')}`;
      const snapshots: SnapshotDraft[] = [
        {
          entityType: 'SERP',
          key: snapshotId,
          data: {
            snapshotId,
            queryId: item.queryId,
            obsDate: ctx.obsDate,
            weakResultRatio: weakRatio,
            weaknessScore: weaknessResult.score,
            items,
          },
        },
      ];

      // 5. Assemble Evidence Draft
      const evidence: EvidenceDraft[] = [];
      if (item.opportunityId && items.length > 0) {
        const weakCount = items.filter((i) => i.isWeak).length;
        const topWeak = items.find((i) => i.isWeak);
        evidence.push({
          opportunityId: item.opportunityId,
          evidenceClass: 'OBSERVED',
          sourceType: 'SERP',
          sourceId: this.sourceId,
          domain: topWeak?.domain,
          title: `SERP Top 10 Weakness Ratio for "${item.queryText}"`,
          snippet: `${weakCount}/${items.length} stored organic results are marked weak (ratio ${Math.round(
            weakRatio * 100
          )}%).`,
          payload: {
            queryText: item.queryText,
            top10Count: items.length,
            weakCount,
            weakRatio,
            weaknessScore: weaknessResult.score,
            results: items.slice(0, 5),
          },
          observedAt: ctx.clock(),
        });
      }

      const rawContent = JSON.stringify({
        query: item.queryText,
        marketCountry: item.marketCountry,
        obsDate: ctx.obsDate,
        items,
      });

      return {
        status: 'OK',
        snapshots,
        evidence,
        raw: {
          content: rawContent,
          contentHash: createHash('sha256').update(rawContent).digest('hex'),
          mimeType: 'application/json',
        },
        cost: {
          sourceId: this.sourceId,
          opportunityId: item.opportunityId,
          costUsd: this.costPerQueryUsd,
          category: 'SERP',
          units: 1,
        },
      };
    } catch (err: any) {
      return {
        status: 'FAILED',
        retryable: true,
        errorCode: 'SERP_FETCH_ERROR',
        message: err.message,
      };
    }
  }

  private classifyDomainAuthority(domain: string): string {
    const d = domain.toLowerCase();
    if (
      d.includes('wikipedia.org') ||
      d.includes('amazon.') ||
      d.includes('nytimes.com') ||
      d.includes('forbes.com') ||
      d.includes('microsoft.com')
    ) {
      return 'HIGH_AUTHORITY_GENERIC';
    }
    if (
      d.includes('reddit.com') ||
      d.includes('quora.com') ||
      d.includes('stackoverflow.com') ||
      d.includes('news.ycombinator.com')
    ) {
      return 'COMMUNITY_FORUM';
    }
    if (
      d.includes('capterra.com') ||
      d.includes('g2.com') ||
      d.includes('softwareadvice.com') ||
      d.includes('trustpilot.com')
    ) {
      return 'AGGREGATOR';
    }
    if (
      d.includes('github.io') ||
      d.includes('vercel.app') ||
      d.includes('.dev') ||
      d.includes('.tools') ||
      d.includes('tool')
    ) {
      return 'INDEPENDENT_MICRO';
    }
    return 'SPECIALIST';
  }

  private async fetchSerp(
    query: string,
    marketCountry: string,
    language: string
  ): Promise<
    Array<{
      rank: number;
      url: string;
      domain: string;
      title: string;
      snippet: string;
      resultType: ResultType;
      ageDays?: number;
      relevance?: number;
      publishedAt?: Date;
    }> | null
  > {
    const serpApiKey = process.env.SERP_API_KEY;
    if (serpApiKey) {
      const fromSerpApi = await this.fetchSerpApi(query, marketCountry, language, serpApiKey);
      if (fromSerpApi && fromSerpApi.length > 0) return fromSerpApi;
    }

    const braveKey = process.env.BRAVE_API_KEY;
    if (braveKey) {
      const fromBrave = await this.fetchBrave(query, marketCountry, braveKey);
      if (fromBrave && fromBrave.length > 0) return fromBrave;
    }

    return null;
  }

  private async fetchSerpApi(
    query: string,
    marketCountry: string,
    language: string,
    apiKey: string
  ) {
    try {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(
        query
      )}&gl=${encodeURIComponent(marketCountry)}&hl=${encodeURIComponent(language)}&num=10&api_key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data.organic_results)) return null;
      return data.organic_results
        .slice(0, 10)
        .map((r: any, idx: number) => {
          const urlStr = String(r.link || '');
          return {
            rank: idx + 1,
            url: urlStr,
            domain: this.extractDomain(urlStr),
            title: String(r.title || ''),
            snippet: String(r.snippet || ''),
            resultType: this.inferResultType(urlStr, r.title || '', r.snippet || ''),
          };
        })
        .filter((row: { url: string }) => row.url.startsWith('http'));
    } catch {
      return null;
    }
  }

  private async fetchBrave(query: string, marketCountry: string, apiKey: string) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
        query
      )}&count=10&country=${encodeURIComponent(marketCountry)}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const results = data.web?.results;
      if (!Array.isArray(results)) return null;
      return results
        .slice(0, 10)
        .map((r: any, idx: number) => {
          const urlStr = String(r.url || '');
          return {
            rank: idx + 1,
            url: urlStr,
            domain: this.extractDomain(urlStr),
            title: String(r.title || ''),
            snippet: String(r.description || ''),
            resultType: this.inferResultType(urlStr, r.title || '', r.description || ''),
          };
        })
        .filter((row: { url: string }) => row.url.startsWith('http'));
    } catch {
      return null;
    }
  }

  private extractDomain(urlStr: string): string {
    try {
      const u = new URL(urlStr);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown.com';
    }
  }

  private inferResultType(url: string, title: string, snippet: string): ResultType {
    const text = `${url} ${title} ${snippet}`.toLowerCase();
    if (text.includes('reddit.com') || text.includes('quora.com') || text.includes('forum')) {
      return 'UGC_THREAD';
    }
    if (text.includes('best ') && (text.includes('2025') || text.includes('2026') || text.includes('reviews'))) {
      return 'LISTICLE_AFFILIATE';
    }
    if (text.includes('quora.com') || text.includes('answers') || text.includes('q&a')) {
      return 'QA';
    }
    if (text.includes('youtube.com') || text.includes('vimeo.com')) {
      return 'VIDEO';
    }
    if (text.includes('docs.') || text.includes('documentation') || text.includes('/wiki/')) {
      return 'DOC';
    }
    if (text.includes('official site') || text.includes('home page') || text.includes('login')) {
      return 'OFFICIAL';
    }
    return 'SPECIALIST';
  }

}
