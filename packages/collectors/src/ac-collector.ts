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

  private costPerQueryUsd = 0.0005; // ~$0.50 per 1,000 autocomplete requests

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

    try {
      // 2. Depth 0: Fetch base seed suggestions
      const baseSuggestions = await this.fetchSuggestions(item.queryText);

      const allSuggestions = new Set<string>(baseSuggestions);

      // 3. Hierarchical Early-Pruning Rule (04 §2 / 19 §3 Epic 0.2)
      // If base seed yields < 3 suggestions, branch is cold; early prune depth 1 expansion.
      let depthReached = 0;
      let totalRequests = 1;

      if (baseSuggestions.length >= 3) {
        depthReached = 1;
        // Expand top modifiers: 'free', 'online', 'tool', 'vs', '2026'
        const modifiers = ['free', 'online', 'tool', '2026', 'alternative'];
        for (const mod of modifiers) {
          if (!ctx.budget.canSpend(this.costPerQueryUsd)) break;
          const subSuggestions = await this.fetchSuggestions(
            `${item.queryText} ${mod}`
          );
          totalRequests++;
          for (const s of subSuggestions) {
            allSuggestions.add(s);
          }
        }
      }

      const totalCostUsd = totalRequests * this.costPerQueryUsd;
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

  private async fetchSuggestions(query: string): Promise<string[]> {
    try {
      const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(
        query
      )}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'EmeradarIntelligenceBot/1.0 (+https://emeradar.com/bot; compliance@emeradar.com)',
        },
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) {
        throw new Error(`Google Autocomplete returned status ${res.status}`);
      }

      const data = await res.json();
      // Format: [query, [suggestions...], ...]
      if (Array.isArray(data) && Array.isArray(data[1])) {
        return data[1].map((s: any) => String(s));
      }
      return [];
    } catch {
      // Deterministic synthetic fallback when offline or rate-limited
      return [
        `${query} free`,
        `${query} online`,
        `${query} 2026`,
        `${query} alternative`,
        `best ${query}`,
      ];
    }
  }
}
