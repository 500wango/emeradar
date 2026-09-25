export interface FactItem {
  id: string; // e.g. 'F1'
  template: string; // e.g. '过去 7 天新增 {{F1.new_queries_7d}} 个相关 autocomplete query'
  values: Record<string, string | number>;
  evidenceIds?: string[];
  snapshotIds?: string[];
}

export interface FactBundle {
  facts: FactItem[];
}

export type StatementKind = 'FACT' | 'SUGGESTION';

export interface Statement {
  kind: StatementKind;
  text: string;
  cites: string[];
  renderedText?: string;
}

export interface StatementBundle {
  statements: Statement[];
}

export interface SerpClassifiedItem {
  rank: number;
  resultType:
    | 'SPECIALIST'
    | 'OFFICIAL'
    | 'EDITORIAL_MEDIA'
    | 'LISTICLE_AFFILIATE'
    | 'DIRECTORY'
    | 'UGC_THREAD'
    | 'QA'
    | 'VIDEO'
    | 'DOC'
    | 'THIN_PAGE'
    | 'OFF_TOPIC';
  relevance: number;
  isSpecialist: boolean;
  reason?: string;
}

export interface PricingTier {
  name: string;
  priceText: string;
  priceAmount: number;
  currency: string;
  billingPeriod: 'MONTH' | 'YEAR' | 'ONE_TIME' | 'USAGE' | 'UNKNOWN';
  isFree: boolean;
}

export interface PricingExtractionResult {
  tiers: PricingTier[];
  hasCheckoutEntry: boolean;
}

export interface EntityMergePair {
  candidate: string;
  matchedEntityId: string | null;
  confidence: number;
  reason: string;
}

export interface LlmRunRecord {
  promptId: string;
  model: string;
  inputHash: string;
  outputRaw: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  citationValid: boolean;
  errorMessage?: string;
}
