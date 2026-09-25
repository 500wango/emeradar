import { EvidenceClass } from '@emeradar/core';

export interface CostRecord {
  sourceId: string;
  opportunityId?: string;
  costUsd: number;
  category: 'AUTOCOMPLETE' | 'SERP' | 'CRAWL' | 'LLM' | 'INFRA';
  units?: number;
}

export interface BudgetGuard {
  maxDailyBudgetUsd: number;
  currentSpentUsd: number;
  canSpend(costUsd: number): boolean;
}

export interface RunContext {
  runId: string;
  obsDate: string; // YYYY-MM-DD
  clock: () => Date;
  budget: BudgetGuard;
}

export interface SnapshotDraft {
  entityType: 'AUTOCOMPLETE' | 'SERP' | 'COMMERCIAL';
  key: string;
  data: any;
}

export interface EvidenceDraft {
  opportunityId: string;
  evidenceClass: EvidenceClass;
  sourceType: string;
  sourceId: string;
  domain?: string;
  title: string;
  snippet: string;
  payload: any;
  observedAt: Date;
}

export interface RawPayloadDraft {
  content: string;
  contentHash: string;
  mimeType: string;
}

export type CollectOutcome =
  | {
      status: 'OK';
      snapshots: SnapshotDraft[];
      evidence: EvidenceDraft[];
      raw?: RawPayloadDraft;
      cost: CostRecord;
    }
  | {
      status: 'SKIPPED';
      reason: 'ROBOTS_DISALLOWED' | 'BUDGET' | 'NOT_MODIFIED' | 'DUPLICATE';
    }
  | {
      status: 'FAILED';
      retryable: boolean;
      errorCode: string;
      message: string;
      cost?: CostRecord;
    };

export interface PlannedBatch<TItem> {
  batchId: string;
  items: TItem[];
  estimatedCostUsd: number;
}

export interface Collector<TScope, TItem> {
  readonly sourceId: string;
  readonly version: string;
  readonly limits: {
    maxConcurrency: number;
    ratePerSecond: number;
    perDomainRatePerSecond?: number;
  };

  plan(ctx: RunContext, scope: TScope): Promise<PlannedBatch<TItem>>;
  collect(ctx: RunContext, item: TItem): Promise<CollectOutcome>;
}
