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

/**
 * 采集深度（04 §9.2、PRD F1.1「一鱼多吃」）。
 *
 * rank 1–10 参与 F6 弱点计算，11–100 只用于在内存中匹配已核验项目，**不为追踪中的
 * 项目单独发起任何 SERP 请求**。所以这里的深度是一次请求换两种用途，把它提到 100
 * 不增加任何调用次数。
 */
export const SERP_DEPTH = 100;
/** 参与评分的名次上限（05 §3.3）。深于它的部分只进 `rankIndex`。 */
export const SERP_SCORING_DEPTH = 10;

/**
 * 名次索引里的一行。只带匹配所需的三列——完整条目（摘要、分类、弱点判定）只对
 * 评分用的前 10 名有意义，给 11–100 也编一套摘要，等于假装我们对它们做了分析。
 */
export interface SerpRankIndexEntry {
  rank: number;
  url: string;
  domain: string;
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
            'No organic SERP provider returned results. Set SERP_API_KEY (SerpAPI), AISA_API_KEY (AIsa.one), or BRAVE_API_KEY. A failed fetch is not scored.',
        };
      }

      // 3. 评分只吃前 10 名（05 §3.3）。深于 10 的部分不参与弱点计算，也不进证据
      //    载荷——它唯一的用途是让「已核验项目是否入榜」这件事有得可查。
      const ranked = [...rawItems].sort((a, b) => a.rank - b.rank);
      const top = ranked.filter((raw) => raw.rank <= SERP_SCORING_DEPTH);

      const scoredInput: SerpItemInput[] = top.map((raw) => ({
        rank: raw.rank,
        url: raw.url,
        domain: raw.domain,
        title: raw.title,
        resultType: raw.resultType,
        ageDays: raw.ageDays,
      }));

      const weaknessResult = calculateSerpWeakness(scoredInput);

      // 按 rank 取弱点结论，不按数组下标：`weaknessResult.items` 是评分集（rank 1–10）
      // 的顺序，而 `ranked` 可能长得多。用下标对齐是这次改动最容易埋进去的错——它
      // 只在某个名次缺失时才显形，而那时错误已经进了库。
      const weaknessByRank = new Map(weaknessResult.items.map((scored) => [scored.rank, scored]));

      const items: SerpCollectedItem[] = top.map((raw) => {
        const scored = weaknessByRank.get(raw.rank);
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

      const rankIndex: SerpRankIndexEntry[] = ranked.map((raw) => ({
        rank: raw.rank,
        url: raw.url,
        domain: raw.domain,
      }));

      // 分母是**评分集**的大小，不是取回的条数。用后者会把比率从"前 10 名里几个是
      // 弱点"变成"前 100 名里几个是弱点"，同一个词在两天的深度下得出两个不可比的数。
      const weakRatio =
        top.length > 0 ? Math.round((weaknessResult.weakCount / top.length) * 10000) / 10000 : 0;

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
            /** 请求的深度（`serp_snapshots.depth`）。 */
            depth: SERP_DEPTH,
            /** 实际取回条数（`serp_snapshots.result_count`）。各有各的上限：Brave 与
             *  Tavily 只给到 20，SerpApi 给到 100。低于 depth 是常态，不是故障。 */
            resultCount: ranked.length,
            items,
            rankIndex,
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

    const aisaKey = process.env.AISA_API_KEY;
    if (aisaKey) {
      const fromAIsa = await this.fetchAIsa(query, marketCountry, language, aisaKey);
      if (fromAIsa && fromAIsa.length > 0) return fromAIsa;
    }

    const braveKey = process.env.BRAVE_API_KEY;
    if (braveKey) {
      const fromBrave = await this.fetchBrave(query, marketCountry, braveKey);
      if (fromBrave && fromBrave.length > 0) return fromBrave;
    }

    return null;
  }

  private async fetchAIsa(
    query: string,
    marketCountry: string,
    language: string,
    apiKey: string
  ) {
    try {
      const endpoint = process.env.AISA_SEARCH_URL || 'https://api.aisa.one/apis/v1/tavily/search';
      const isDataForSeo = endpoint.includes('dataforseo');

      const body = isDataForSeo
        ? JSON.stringify([
            {
              keyword: query,
              location_code: marketCountry === 'US' ? 2840 : undefined,
              language_code: language || 'en',
              // 一鱼多吃（04 §9.2）：一次请求拿满深度，前 10 名进评分，其余进匹配索引。
              depth: SERP_DEPTH,
            },
          ])
        : JSON.stringify({
            query,
            search_depth: 'basic',
            // Tavily 的上限是 20，这就是它的最大深度；再往上要换 provider，而不是
            // 编一个对方不接受的数字。
            max_results: 20,
            include_answer: false,
          });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return null;
      const data = await res.json();

      // Format 1: Tavily / Web Search format ({ results: [{ title, url, content }] })
      if (Array.isArray(data?.results)) {
        return data.results
          .slice(0, SERP_DEPTH)
          .map((r: any, idx: number) => {
            const urlStr = String(r.url || '');
            const title = String(r.title || '');
            const snippet = String(r.content || r.snippet || '');
            return {
              rank: idx + 1,
              url: urlStr,
              domain: this.extractDomain(urlStr),
              title,
              snippet,
              resultType: this.inferResultType(urlStr, title, snippet),
              publishedAt: r.published_date ? new Date(r.published_date) : undefined,
            };
          })
          .filter((row: { url: string }) => row.url.startsWith('http'));
      }

      // Format 2: DataForSEO SERP format ({ tasks: [{ result: [{ items: [...] }] }] })
      const dfsItems = data?.tasks?.[0]?.result?.[0]?.items;
      if (Array.isArray(dfsItems)) {
        return dfsItems
          .filter((i: any) => (i.type === 'organic' || !i.type) && i.url)
          .slice(0, SERP_DEPTH)
          .map((r: any, idx: number) => {
            const urlStr = String(r.url || '');
            const title = String(r.title || '');
            const snippet = String(r.description || r.snippet || '');
            return {
              rank: r.rank_group || idx + 1,
              url: urlStr,
              domain: this.extractDomain(urlStr),
              title,
              snippet,
              resultType: this.inferResultType(urlStr, title, snippet),
            };
          })
          .filter((row: { url: string }) => row.url.startsWith('http'));
      }

      // Format 3: Generic items array format ({ items: [...] })
      if (Array.isArray(data?.items)) {
        return data.items
          .slice(0, SERP_DEPTH)
          .map((r: any, idx: number) => {
            const urlStr = String(r.url || r.link || '');
            const title = String(r.title || '');
            const snippet = String(r.snippet || r.excerpt || r.description || '');
            return {
              rank: idx + 1,
              url: urlStr,
              domain: this.extractDomain(urlStr),
              title,
              snippet,
              resultType: this.inferResultType(urlStr, title, snippet),
            };
          })
          .filter((row: { url: string }) => row.url.startsWith('http'));
      }

      return null;
    } catch {
      return null;
    }
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
      )}&gl=${encodeURIComponent(marketCountry)}&hl=${encodeURIComponent(language)}&num=${SERP_DEPTH}&api_key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data.organic_results)) return null;
      return data.organic_results
        .slice(0, SERP_DEPTH)
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
      )}&count=20&country=${encodeURIComponent(marketCountry)}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const results = data.web?.results;
      if (!Array.isArray(results)) return null;
      return results
        .slice(0, SERP_DEPTH)
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
