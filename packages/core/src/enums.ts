export const Verdict = {
  BUILD_NOW: 'BUILD_NOW',
  EARLY_BET: 'EARLY_BET',
  WINDOW_CLOSING: 'WINDOW_CLOSING',
  WATCH: 'WATCH',
  PASS: 'PASS',
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

export const Lifecycle = {
  FORMING: 'FORMING',
  EARLY_WINDOW: 'EARLY_WINDOW',
  CONTESTED: 'CONTESTED',
  MATURE: 'MATURE',
  DEAD: 'DEAD',
} as const;
export type Lifecycle = (typeof Lifecycle)[keyof typeof Lifecycle];

export const Band = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INSUFFICIENT: 'INSUFFICIENT',
} as const;
export type Band = (typeof Band)[keyof typeof Band];

export const Confidence = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type Confidence = (typeof Confidence)[keyof typeof Confidence];

export const EvidenceClass = {
  OBSERVED: 'OBSERVED',
  SELF_REPORTED: 'SELF_REPORTED',
  THIRD_PARTY_ESTIMATE: 'THIRD_PARTY_ESTIMATE',
  INFERRED: 'INFERRED',
} as const;
export type EvidenceClass = (typeof EvidenceClass)[keyof typeof EvidenceClass];

export const BuildArchetype = {
  LIGHTWEIGHT_TOOL: 'LIGHTWEIGHT_TOOL',
  PSEO_SITE: 'PSEO_SITE',
  DIRECTORY: 'DIRECTORY',
  MICRO_SAAS: 'MICRO_SAAS',
  CONTENT_SITE: 'CONTENT_SITE',
  TOOL: 'TOOL',
} as const;
export type BuildArchetype = (typeof BuildArchetype)[keyof typeof BuildArchetype];

export const MonetizationRoute = {
  ADS_AFFILIATE: 'ADS_AFFILIATE',
  LEAD_GEN: 'LEAD_GEN',
  SAAS_SUBSCRIPTION: 'SAAS_SUBSCRIPTION',
  DIRECTORY_MARKETPLACE: 'DIRECTORY_MARKETPLACE',
  API_DEVELOPER: 'API_DEVELOPER',
} as const;
export type MonetizationRoute = (typeof MonetizationRoute)[keyof typeof MonetizationRoute];

export const RouteGrade = {
  PRIMARY: 'PRIMARY',
  SECONDARY: 'SECONDARY',
  NOT_RECOMMENDED: 'NOT_RECOMMENDED',
} as const;
export type RouteGrade = (typeof RouteGrade)[keyof typeof RouteGrade];

export const ExecutionClass = {
  S: 'S',
  M: 'M',
  L: 'L',
} as const;
export type ExecutionClass = (typeof ExecutionClass)[keyof typeof ExecutionClass];

export const Decision = {
  GO: 'GO',
  PASS: 'PASS',
} as const;
export type Decision = (typeof Decision)[keyof typeof Decision];

export const TimeBudget = {
  WEEKEND: 'WEEKEND',
  TWO_WEEKS: 'TWO_WEEKS',
  ONE_MONTH: 'ONE_MONTH',
} as const;
export type TimeBudget = (typeof TimeBudget)[keyof typeof TimeBudget];

export const Tier = {
  A: 'A',
  B: 'B',
  C: 'C',
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

export const OpportunityStatus = {
  CANDIDATE: 'CANDIDATE',
  TRACKED: 'TRACKED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type OpportunityStatus = (typeof OpportunityStatus)[keyof typeof OpportunityStatus];

export const CommercialStage = {
  NONE: 'NONE',
  INTENT_ONLY: 'INTENT_ONLY',
  INFRA_PRESENT: 'INFRA_PRESENT',
  PRICED: 'PRICED',
  PAID_PERSISTENT: 'PAID_PERSISTENT',
  REVENUE_EVIDENCED: 'REVENUE_EVIDENCED',
} as const;
export type CommercialStage = (typeof CommercialStage)[keyof typeof CommercialStage];

export const ValidationLevel = {
  DIRECT: 'DIRECT',
  CATEGORY: 'CATEGORY',
  ANALOG: 'ANALOG',
} as const;
export type ValidationLevel = (typeof ValidationLevel)[keyof typeof ValidationLevel];

export const Intent = {
  INFORMATIONAL: 'INFORMATIONAL',
  COMMERCIAL: 'COMMERCIAL',
  TRANSACTIONAL: 'TRANSACTIONAL',
  NAVIGATIONAL: 'NAVIGATIONAL',
} as const;
export type Intent = (typeof Intent)[keyof typeof Intent];

export const Priority = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const Locale = {
  ZH_CN: 'zh-CN',
  EN_US: 'en-US',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];
