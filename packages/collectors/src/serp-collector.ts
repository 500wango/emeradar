import { createHash } from 'node:crypto';
import {
  calculateSerpWeakness,
  classifyAuthority,
  classifyPage,
  ResultType,
  SerpItemInput,
  PAGE_CLASSIFIER_VERSION,
} from '@emeradar/scoring';
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
  /** 请求深度；缺省为 `SERP_DEFAULT_DEPTH`。只有项目排名追踪的周采集传 100。 */
  depth?: number;
}

export interface SerpCollectedItem {
  rank: number;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  resultType: ResultType;
  /** 页面种类（确定性分类器），落库后可按版本重算。 */
  pageKind?: string;
  classifierVersion?: string;
  /**
   * 查询级任务满足度（审计 02）：「是工具页」≠「能解决这个搜索任务」。
   * 与 resultType 一起落库（serp_results.query_relevance）。
   */
  queryRelevance?: 'SATISFIES' | 'NOT_SATISFIED' | 'UNKNOWN';
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
/**
 * 默认采集深度（ADR-022、PRD v2.2 F1 第 1 条）。Google 自 2025 年 9 月停用 `num=100`，
 * Top 100 要按 10 条一页计 10 次请求，所以只有映射到已核验 Project 的 query 才取 100。
 */
export const SERP_DEFAULT_DEPTH = 10;
/** 参与评分的名次上限（05 §3.3）。深于它的部分只进 `rankIndex`。 */
export const SERP_SCORING_DEPTH = 10;

/** Google-only SERP providers. Brave is deliberately absent: its index is not Google. */
export type SerpProvider = 'SERPAPI' | 'AISA_DATAFORSEO';

export interface SerpFetchResult {
  provider: SerpProvider;
  items: Array<{
    rank: number;
    url: string;
    domain: string;
    title: string;
    snippet: string;
    resultType: ResultType;
    ageDays?: number;
    relevance?: number;
    publishedAt?: Date;
  }>;
}

/**
 * 名次索引里的一行。只带匹配所需的三列——完整条目（摘要、分类、弱点判定）只对
 * 评分用的前 10 名有意义，给 11–100 也编一套摘要，等于假装我们对它们做了分析。
 */
export interface SerpRankIndexEntry {
  rank: number;
  url: string;
  domain: string;
}

export const AISA_GOOGLE_ORGANIC_URL =
  'https://api.aisa.one/apis/v1/dataforseo/serp/google/organic/live/regular';

/** DataForSEO 的 `location_code`。研究市场目前只有 US（2840）；其它市场不猜代码，交给 API 报错。 */
function locationCode(marketCountry: string): number | undefined {
  // 只列已明确配置的市场；其它市场不猜代码，交给 API 报错。
  const code = (marketCountry || 'US').toUpperCase();
  return ({ US: 2840, GB: 2826, CA: 2124, AU: 2036 } as Record<string, number>)[code];
}

interface ParsedOrganicItem {
  rank: number;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  resultType: ResultType;
}

/**
 * 解析 DataForSEO 的 SERP 信封。注意它把「请求被拒」也包在 HTTP 200 里，结论在
 * `tasks[0].status_code`（20000 才是成功），所以只看 `res.ok` 会把拒绝当成「零结果」。
 *
 * 名次取 `rank_group`（自然结果内部的序号），不取 `rank_absolute`（把精选摘要、视频等
 * SERP 特性也算进去）：W 轴评的是自然结果前 10 名。
 */
export function parseDataForSeoOrganic(
  body: unknown,
  depth: number,
  inferResultType: (url: string, title: string, snippet: string) => ResultType
): ParsedOrganicItem[] | null {
  const task = (body as any)?.tasks?.[0];
  if (!task || task.status_code !== 20000) return null;
  const items = task.result?.[0]?.items;
  if (!Array.isArray(items)) return null;
  return items
    .filter((i: any) => i?.type === 'organic' && typeof i.url === 'string' && i.url.startsWith('http'))
    .map((i: any) => {
      const url = String(i.url);
      const title = String(i.title || '');
      const snippet = String(i.description || '');
      let domain = 'unknown.com';
      try {
        domain = new URL(url).hostname.replace(/^www\./, '');
      } catch {}
      return {
        rank: Number.isInteger(i.rank_group) ? i.rank_group : 0,
        url,
        domain,
        title,
        snippet,
        resultType: inferResultType(url, title, snippet),
      };
    })
    .filter((row: ParsedOrganicItem) => row.rank >= 1 && row.rank <= depth);
}

export class SerpCollector implements Collector<SerpTarget[], SerpTarget> {
  readonly sourceId = 'src_serp';
  readonly version = '1.0.0';
  readonly limits = {
    maxConcurrency: 2,
    ratePerSecond: 2,
  };

  private costPerQueryUsd = 0.002; // DataForSEO live/regular via AIsa: $0.002 per Top-10 page (2026-10-18)

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

    const depth = Math.min(SERP_DEPTH, Math.max(SERP_SCORING_DEPTH, item.depth ?? SERP_DEFAULT_DEPTH));
    try {
      const fetched = await this.fetchSerp(
        item.queryText,
        item.marketCountry || 'US',
        item.researchLanguage || 'en',
        depth
      );
      const rawItems = fetched?.items;
      if (!fetched || !rawItems || rawItems.length === 0) {
        return {
          status: 'FAILED',
          retryable: true,
          errorCode: 'SERP_UNAVAILABLE',
          message:
            'No Google organic SERP provider returned results. Set SERP_API_KEY (SerpAPI) or AISA_API_KEY (AIsa.one → DataForSEO Google). A failed fetch is not scored; Brave is not a Google fallback.',
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
        // 审计 02：确证不满足的工具页按低相关参与 W 调整；UNKNOWN 不改分。
        queryRelevance: this.classifyItem(raw.url, raw.title, raw.snippet, item.queryText)
          .queryRelevance,
      }));

      const weaknessResult = calculateSerpWeakness(scoredInput);

      // 按 rank 取弱点结论，不按数组下标：`weaknessResult.items` 是评分集（rank 1–10）
      // 的顺序，而 `ranked` 可能长得多。用下标对齐是这次改动最容易埋进去的错——它
      // 只在某个名次缺失时才显形，而那时错误已经进了库。
      const weaknessByRank = new Map(weaknessResult.items.map((scored) => [scored.rank, scored]));

      const items: SerpCollectedItem[] = top.map((raw) => {
        const scored = weaknessByRank.get(raw.rank);
        const classification = this.classifyItem(raw.url, raw.title, raw.snippet, item.queryText);
        return {
          rank: raw.rank,
          url: raw.url,
          domain: raw.domain,
          title: raw.title,
          snippet: raw.snippet,
          resultType: raw.resultType,
          pageKind: classification.kind,
          queryRelevance: classification.queryRelevance,
          classifierVersion: PAGE_CLASSIFIER_VERSION,
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
            provider: fetched.provider,
            weakResultRatio: weakRatio,
            weaknessScore: weaknessResult.score,
            /** 请求的深度（`serp_snapshots.depth`）。 */
            depth,
            /** 实际取回条数（`serp_snapshots.result_count`）。各有各的上限：Brave 只给到
             *  20，SerpApi 与 DataForSEO 给到 100。低于 depth 是常态，不是故障。 */
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
        // 审计 02：任务满足度是独立于页面性质的观察结论，进证据载荷供审计。
        const satisfiedCount = items.filter((i) => i.queryRelevance === 'SATISFIES').length;
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
          )}%). ${satisfiedCount}/${items.length} verifiably satisfy the query.`,
          payload: {
            queryText: item.queryText,
            provider: fetched.provider,
            top10Count: items.length,
            weakCount,
            weakRatio,
            weaknessScore: weaknessResult.score,
            querySatisfiedCount: satisfiedCount,
            results: items.slice(0, 5),
          },
          observedAt: ctx.clock(),
        });
      }

      const rawContent = JSON.stringify({
        query: item.queryText,
        marketCountry: item.marketCountry,
        obsDate: ctx.obsDate,
        provider: fetched.provider,
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
    // 与页面分类共用同一份注册表：两处各判各的正是 LinkedIn 一边 SPECIALIST
    // 一边 COMMUNITY_FORUM 的原因。
    return classifyAuthority(`https://${domain}/`, domain);
  }


  private async fetchSerp(
    query: string,
    marketCountry: string,
    language: string,
    depth: number
  ): Promise<SerpFetchResult | null> {
    const serpApiKey = process.env.SERP_API_KEY;
    if (serpApiKey) {
      const fromSerpApi = await this.fetchSerpApi(query, marketCountry, language, serpApiKey, depth);
      if (fromSerpApi && fromSerpApi.length > 0) return { provider: 'SERPAPI', items: fromSerpApi };
    }

    const aisaKey = process.env.AISA_API_KEY;
    if (aisaKey) {
      const fromAIsa = await this.fetchAIsaGoogle(query, marketCountry, language, aisaKey, depth);
      if (fromAIsa && fromAIsa.length > 0) return { provider: 'AISA_DATAFORSEO', items: fromAIsa };
    }

    return null;
  }

  /**
   * Google 自然结果，经 AIsa 代理的 DataForSEO（`serp/google/organic/live/regular`）。
   *
   * 这里曾经调 AIsa 的 Tavily 搜索。Tavily 是 AI 搜索引擎的自有索引，不是 Google 排名：
   * 2026-10-18 的 95 个快照里出现最多的域名是 facebook / youtube / instagram，拿它算
   * W 轴的「SERP 弱点」等于在量另一个搜索引擎。所以这条路径只认 DataForSEO 的 Google
   * 结果；取不到就让本次采集失败（不评分），不回退到别的索引冒充。
   *
   * 选 `regular` 而不是 `advanced`：同价（每 10 条一页计费），响应 ~5 KB 对 ~57 KB，
   * 评分只用 rank / url / title / description。实测 `regular` 8 s、`advanced` 12 s，
   * 所以超时放宽到 30 s。
   */
  private async fetchAIsaGoogle(
    query: string,
    marketCountry: string,
    language: string,
    apiKey: string,
    depth: number
  ) {
    try {
      const res = await fetch(AISA_GOOGLE_ORGANIC_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            keyword: query,
            location_code: locationCode(marketCountry),
            language_code: (language || 'en').slice(0, 2).toLowerCase(),
            // 深度分层（ADR-022）：默认 10；项目排名追踪的周采集才取 100。
            depth,
          },
        ]),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      return parseDataForSeoOrganic(await res.json(), depth, (url, title, snippet) =>
        this.inferResultType(url, title, snippet)
      );
    } catch {
      return null;
    }
  }

  private async fetchSerpApi(
    query: string,
    marketCountry: string,
    language: string,
    apiKey: string,
    depth: number
  ) {
    try {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(
        query
      )}&gl=${encodeURIComponent(marketCountry)}&hl=${encodeURIComponent(language)}&num=${depth}&api_key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data.organic_results)) return null;
      return data.organic_results
        .slice(0, depth)
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

  private extractDomain(urlStr: string): string {
    try {
      const u = new URL(urlStr);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown.com';
    }
  }

  private inferResultType(url: string, title: string, snippet: string): ResultType {
    // 分类只有一处实现（`@emeradar/scoring/page-classifier`）：确定性注册表 +
    // 路径/标题证据，未知即 UNCLASSIFIED。旧的 substring 匹配（`includes('login')`）
    // 与 SPECIALIST 默认值会把 wix.com、LinkedIn 判成正面竞争。
    return classifyPage(url, title, snippet).resultType;
  }

  /** 页面种类、查询满足度与分类器版本一起返回，落库后历史可按版本分组重算。 */
  private classifyItem(url: string, title: string, snippet: string, query = '') {
    return classifyPage(url, title, snippet, query);
  }


}
