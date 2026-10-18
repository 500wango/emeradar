import { createHash } from 'node:crypto';
import {
  Collector,
  CollectOutcome,
  RunContext,
  PlannedBatch,
  SnapshotDraft,
  EvidenceDraft,
} from './types';

export interface AutocompleteTarget {
  queryId: string;
  queryText: string;
  opportunityId?: string;
  marketCountry?: string;
  language?: string;
  researchLanguage?: string;
}

/** DataForSEO 的 `location_code`。研究市场目前只有 US（2840）；其它市场不猜代码。 */
function locationCode(marketCountry: string): number | undefined {
  // 只列已明确配置的市场；其它市场不猜代码，交给 API 报错。
  const code = (marketCountry || 'US').toUpperCase();
  return ({ US: 2840, GB: 2826, CA: 2124, AU: 2036 } as Record<string, number>)[code];
}

export class AutocompleteCollector
  implements Collector<AutocompleteTarget[], AutocompleteTarget>
{
  readonly sourceId = 'src_ac';
  readonly version = '1.0.0';
  readonly limits = {
    maxConcurrency: 3,
    ratePerSecond: 5,
  };

  /**
   * 兜底单价（AIsa 响应头缺失时使用）。真实成本优先读
   * `x-aisa-customer-cost-micros-usd`，避免账本与供应商账单对不上。
   */
  private costPerQueryUsd = 0.0005;

  async plan(
    ctx: RunContext,
    scope: AutocompleteTarget[]
  ): Promise<PlannedBatch<AutocompleteTarget>> {
    const estimatedCost = scope.length * this.costPerQueryUsd * 2; // base + depth 1
    return {
      batchId: `batch_ac_${ctx.obsDate}_${Date.now()}`,
      items: scope,
      estimatedCostUsd: Math.round(estimatedCost * 10000) / 10000,
    };
  }

  async collect(
    ctx: RunContext,
    item: AutocompleteTarget
  ): Promise<CollectOutcome> {
    // 1. Check budget guard
    if (!ctx.budget.canSpend(this.costPerQueryUsd)) {
      return {
        status: 'SKIPPED',
        reason: 'BUDGET',
      };
    }

    if (!process.env.AISA_API_KEY) {
      return {
        status: 'FAILED',
        retryable: false,
        errorCode: 'AC_NOT_CONFIGURED',
        message: 'AISA_API_KEY is required for Google Autocomplete; the direct scrape fallback was removed.',
      };
    }

    try {
      // 2. Depth 0: Fetch base seed suggestions
      const base = await this.fetchSuggestions(
        item.queryText,
        item.marketCountry,
        item.researchLanguage || item.language
      );
      if (!base) {
        return {
          status: 'FAILED',
          retryable: true,
          errorCode: 'AC_FETCH_ERROR',
          message: 'AIsa Google Autocomplete returned no usable suggestions.',
        };
      }

      const allSuggestions = new Set<string>(base.suggestions);
      let totalCostUsd = base.costUsd;

      // 3. Hierarchical Early-Pruning Rule (04 §2 / 19 §3 Epic 0.2)
      // If base seed yields < 3 suggestions, branch is cold; early prune depth 1 expansion.
      let depthReached = 0;
      let totalRequests = 1;

      if (base.suggestions.length >= 3) {
        depthReached = 1;
        // Expand top modifiers: 'free', 'online', 'tool', 'vs', '2026'
        const modifiers = ['free', 'online', 'tool', '2026', 'alternative'];
        for (const mod of modifiers) {
          if (!ctx.budget.canSpend(this.costPerQueryUsd)) break;
          const sub = await this.fetchSuggestions(
            `${item.queryText} ${mod}`,
            item.marketCountry,
            item.researchLanguage || item.language
          );
          totalRequests++;
          if (sub) {
            totalCostUsd += sub.costUsd;
            for (const s of sub.suggestions) allSuggestions.add(s);
          }
        }
      }

      const suggestionsList = Array.from(allSuggestions);

      // 4. Assemble Draft Snapshot
      const snapshots: SnapshotDraft[] = [
        {
          entityType: 'AUTOCOMPLETE',
          key: `${item.queryId}_${ctx.obsDate}`,
          data: {
            queryId: item.queryId,
            obsDate: ctx.obsDate,
            suggestions: suggestionsList,
            depth: depthReached,
            requestCount: totalRequests,
            provider: 'AISA_DATAFORSEO',
          },
        },
      ];

      // 5. Assemble Evidence Draft
      const evidence: EvidenceDraft[] = [];
      if (item.opportunityId && suggestionsList.length > 0) {
        evidence.push({
          opportunityId: item.opportunityId,
          evidenceClass: 'OBSERVED',
          sourceType: 'AUTOCOMPLETE',
          sourceId: this.sourceId,
          title: `Autocomplete cluster expansions for "${item.queryText}"`,
          snippet: suggestionsList.slice(0, 5).join('; '),
          payload: {
            provider: 'AISA_DATAFORSEO',
            suggestionsCount: suggestionsList.length,
            depth: depthReached,
            topSuggestions: suggestionsList.slice(0, 10),
          },
          observedAt: ctx.clock(),
        });
      }

      const rawContent = JSON.stringify({
        query: item.queryText,
        suggestions: suggestionsList,
        requests: totalRequests,
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
          costUsd: totalCostUsd,
          category: 'AUTOCOMPLETE',
          units: totalRequests,
        },
      };
    } catch (err: any) {
      return {
        status: 'FAILED',
        retryable: true,
        errorCode: 'AC_FETCH_ERROR',
        message: err.message,
      };
    }
  }

  /**
   * Google Autocomplete via AIsa's DataForSEO proxy
   * (`POST /apis/v1/dataforseo/serp/google/autocomplete/live/advanced`).
   *
   * 旧实现直接抓 `suggestqueries.google.com`：没有授权、ToS 风险高、且是 D 轴单点。
   * 现在没有 key 就直接失败，不再静默降级到自采。
   */
  private async fetchSuggestions(
    query: string,
    marketCountry = 'US',
    language = 'en'
  ): Promise<{ suggestions: string[]; costUsd: number } | null> {
    const apiKey = process.env.AISA_API_KEY;
    if (!apiKey) return null;
    try {
      const res = await fetch(
        'https://api.aisa.one/apis/v1/dataforseo/serp/google/autocomplete/live/advanced',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([
            {
              keyword: query,
              location_code: locationCode(marketCountry),
              language_code: (language || 'en').slice(0, 2).toLowerCase(),
              client: 'chrome',
            },
          ]),
          signal: AbortSignal.timeout(20_000),
        }
      );
      if (!res.ok) return null;
      const payload = await res.json();
      const task = payload?.tasks?.[0];
      // DataForSEO 的失败也是 HTTP 200，必须看 status_code。
      if (!task || Number(task.status_code) !== 20000) return null;
      const items = task.result?.[0]?.items;
      if (!Array.isArray(items)) return null;
      const suggestions = items
        .map((row: any) => (typeof row?.suggestion === 'string' ? row.suggestion.trim() : ''))
        .filter((value: string) => value.length > 0);
      if (suggestions.length === 0) return null;
      const costMicros = Number(res.headers.get('x-aisa-customer-cost-micros-usd'));
      const costUsd = Number.isFinite(costMicros) && costMicros > 0 ? costMicros / 1e6 : this.costPerQueryUsd;
      return { suggestions, costUsd };
    } catch {
      return null;
    }
  }
}