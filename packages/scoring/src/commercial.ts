import { CommercialStage } from '@emeradar/core';
import { AxisBand, CommercialSummary } from './types';

export interface CommercialConfig {
  evidenceMaxAgeDays: number;
  persistenceDays: number;
  minSampledDomains: number;
  minSampleCoverage: number;
  strongNegativeMinDomains: number;
  /**
   * 07 §6.1 opens with `sampledDomains < 3 || sampleCoverage < 0.6 -> INSUFFICIENT`.
   * Turning this on before commercial sampling covers enough targets collapses most
   * opportunities to INSUFFICIENT, which also kills Feed/report eligibility
   * (15 §1.7 forbids a dry funnel). Phase 1 records the shortfall instead.
   */
  enforceCoverageGate: boolean;
}

export const COMMERCIAL_DEFAULTS: CommercialConfig = {
  evidenceMaxAgeDays: 120,
  persistenceDays: 90,
  minSampledDomains: 3,
  minSampleCoverage: 0.6,
  strongNegativeMinDomains: 2,
  enforceCoverageGate: false,
};

export interface CommercialBandResult {
  band: AxisBand;
  basisPoints: number;
  stage: CommercialStage;
  pricingDecorationOnly: boolean;
  hasStrongNegative: boolean;
  negativeReasons: string[];
  downgraded: boolean;
  coverageInsufficient: boolean;
  persistenceDaysNeeded: number;
  reason: string;
}

const BASIS_BY_BAND: Record<AxisBand, number> = {
  HIGH: 8200,
  MEDIUM: 6200,
  LOW: 2500,
  INSUFFICIENT: 0,
};

const BAND_BELOW: Record<AxisBand, AxisBand> = {
  HIGH: 'MEDIUM',
  MEDIUM: 'LOW',
  LOW: 'LOW',
  INSUFFICIENT: 'INSUFFICIENT',
};

const NEG_SHUTDOWN = 'NEG_SHUTDOWN_NOTICE';
const NEG_REMOVED = 'NEG_PRICING_REMOVED';
const NEG_PAID_TO_FREE = 'NEG_PAID_TO_FREE';

// 07 §8: collapse to eTLD+1. Unknown multi-part suffixes fall back to two labels,
// which merges rather than splits — the spec asks for the conservative direction.
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'co.in', 'net.in', 'org.in', 'gov.in',
  'com.br', 'net.br', 'org.br',
  'co.kr', 'or.kr', 'ne.kr',
  'com.tw', 'org.tw', 'edu.tw',
  'com.hk', 'org.hk', 'idv.hk',
  'com.sg', 'edu.sg', 'gov.sg',
  'co.nz', 'net.nz', 'org.nz',
  'com.mx', 'com.ar', 'com.co', 'com.pe',
  'fr', 'de', 'it', 'es', 'nl', 'be', 'at', 'ch', 'se', 'no', 'dk', 'fi', 'pl', 'pt', 'ie', 'eu',
]);

export function registrableDomain(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
  if (!normalized) return normalized;
  const labels = normalized.split('.');
  if (labels.length <= 2) return normalized;

  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

export function countIndependentDomains(domains: string[]): number {
  const groups = new Set<string>();
  for (const domain of domains) {
    const root = registrableDomain(domain);
    if (root) groups.add(root);
  }
  return groups.size;
}

export interface SnapshotDiffFacts {
  obsDate: string;
  plansCount: number;
  paidPlansCount: number;
  minPaidPrice: number | null;
  gatewaysCount: number;
  fetchTier: 'STATIC' | 'HEADLESS';
  dynamicShell: boolean;
  fetchStatus: string;
}

export interface SnapshotDiffResult {
  negative?: typeof NEG_REMOVED | typeof NEG_PAID_TO_FREE;
  priceChangeMajor?: boolean;
  priceChangePct?: number;
  fetchTierChangedOnly?: boolean;
  suppressed?:
    | 'CURRENT_NOT_OK'
    | 'NO_PRIOR_SNAPSHOT'
    | 'TIER_CHANGE_ONLY'
    | 'TIER1_EMPTY_NOT_UPGRADED';
}

/**
 * 07 §11 step 5 snapshot diffing, with the §11.5 / §11.1 suppressions:
 * a fetch-tier flip is never a negative signal, and a Tier-1 empty read on a
 * page that was never headless-rendered means "cannot conclude", not "no pricing".
 */
export function classifySnapshotDiff(
  prior: SnapshotDiffFacts | null,
  current: SnapshotDiffFacts
): SnapshotDiffResult {
  if (current.fetchStatus !== 'OK') {
    return { suppressed: 'CURRENT_NOT_OK' };
  }
  if (!prior || prior.fetchStatus !== 'OK') {
    return { suppressed: 'NO_PRIOR_SNAPSHOT' };
  }

  const tierChanged = prior.fetchTier !== current.fetchTier;
  const contentChanged =
    prior.plansCount !== current.plansCount ||
    prior.paidPlansCount !== current.paidPlansCount ||
    prior.gatewaysCount !== current.gatewaysCount;

  if (tierChanged && !contentChanged) {
    return { suppressed: 'TIER_CHANGE_ONLY', fetchTierChangedOnly: true };
  }

  const result: SnapshotDiffResult = {};
  if (tierChanged) result.fetchTierChangedOnly = true;

  const currentReadIsAuthoritative =
    current.fetchTier === 'HEADLESS' || !current.dynamicShell;

  if (prior.plansCount > 0 && current.plansCount === 0) {
    if (currentReadIsAuthoritative) {
      result.negative = NEG_REMOVED;
    } else {
      result.suppressed = 'TIER1_EMPTY_NOT_UPGRADED';
    }
  } else if (prior.paidPlansCount > 0 && current.paidPlansCount === 0 && current.plansCount > 0) {
    result.negative = NEG_PAID_TO_FREE;
  }

  if (prior.minPaidPrice !== null && current.minPaidPrice !== null && prior.minPaidPrice > 0) {
    const delta =
      (current.minPaidPrice - prior.minPaidPrice) / prior.minPaidPrice;
    result.priceChangePct = Math.round(delta * 1000) / 10;
    if (Math.abs(delta) > 0.3) result.priceChangeMajor = true;
  }

  return result;
}

function resolveNegatives(
  summary: CommercialSummary,
  cfg: CommercialConfig
): { strong: boolean; reasons: string[] } {
  const negatives = summary.negatives ?? [];
  const reasons: string[] = [];
  let strong = false;

  for (const neg of negatives) {
    if (neg.domains <= 0) continue;
    const isShutdown = neg.type === NEG_SHUTDOWN;
    const isRemovalSpanningDomains =
      (neg.type === NEG_REMOVED || neg.type === NEG_PAID_TO_FREE) &&
      neg.domains >= cfg.strongNegativeMinDomains;
    if (neg.strong || isShutdown || isRemovalSpanningDomains) {
      strong = true;
    }
    reasons.push(`${neg.type} on ${neg.domains} independent domain(s)`);
  }

  return { strong, reasons };
}

function resolveStage(summary: CommercialSummary, priced: number, persistent: number): CommercialStage {
  const revenue = summary.revenueEvidence
    ? summary.revenueEvidence.observed + summary.revenueEvidence.selfReported
    : 0;

  if (priced >= 1 && revenue >= 1) return CommercialStage.REVENUE_EVIDENCED;
  if (priced >= 1 && persistent >= 1) return CommercialStage.PAID_PERSISTENT;
  if (priced >= 1) return CommercialStage.PRICED;
  if ((summary.infraOnlyDomains ?? 0) >= 1) return CommercialStage.INFRA_PRESENT;
  if ((summary.intentQueryCount ?? 0) >= 1) return CommercialStage.INTENT_ONLY;
  return CommercialStage.NONE;
}

/**
 * M-axis banding per 07-COMMERCIAL-SIGNAL-SPEC §6.1. Pure and deterministic:
 * the assembly layer supplies counts, this decides band / score / stage / negatives.
 */
export function bandM(
  summary: CommercialSummary,
  cfg: CommercialConfig = COMMERCIAL_DEFAULTS
): CommercialBandResult {
  const priced = summary.independentPricedDomains ?? summary.independentDomainsCount;
  const persistent = summary.persistentPricedDomains ?? 0;
  const revenueEvidence = summary.revenueEvidence ?? { observed: 0, selfReported: 0 };
  // 07 §6.1: SELF_REPORTED participates, but never substitutes the OBSERVED P>=2 precondition.
  // 07 §6.1: THIRD_PARTY_ESTIMATE does not participate in banding at all (not read here).
  const revenue = revenueEvidence.observed + revenueEvidence.selfReported;
  const traction = Boolean(summary.hasTransactionTraction);
  const categoryOrAnalog = summary.categoryOrAnalogPricedDomains ?? 0;

  const sampled = summary.sampledDomains;
  const coverage = summary.sampleCoverage;

  const coverageInsufficient =
    (sampled !== undefined && sampled < cfg.minSampledDomains) ||
    (coverage !== undefined && coverage < cfg.minSampleCoverage);

  let band: AxisBand;
  let reason: string;

  const nothingMeasured =
    priced === 0 &&
    (summary.infraOnlyDomains ?? 0) === 0 &&
    (summary.intentQueryCount ?? 0) === 0;

  if (nothingMeasured && (sampled ?? 0) === 0) {
    // Nothing was sampled and nothing was ever observed: "not enough data" is not
    // "no commercial intent" (07 §1.5). An opportunity that was sampled and came back
    // empty is a finding, and bands LOW.
    band = 'INSUFFICIENT';
    reason = 'No commercial target has been successfully sampled yet.';
  } else if (cfg.enforceCoverageGate && coverageInsufficient) {
    band = 'INSUFFICIENT';
    reason = `Commercial sampling is insufficient (${sampled ?? 0} domains, coverage ${
      coverage === undefined ? 'n/a' : `${Math.round(coverage * 100)}%`
    }).`;
  } else if (priced >= 2 && (revenue >= 1 || traction || persistent >= 1)) {
    band = 'HIGH';
    reason =
      persistent >= 1 && !traction && revenue === 0
        ? `${persistent} domain(s) held pricing or checkout across snapshots spanning >= ${cfg.persistenceDays} days.`
        : `${revenue} revenue/traction disclosure(s) plus ${traction ? 'observed transaction traction' : 'pricing'} on ${priced} independent domains.`;
  } else if (priced >= 2 || (priced >= 1 && (categoryOrAnalog >= 1 || traction))) {
    band = 'MEDIUM';
    reason =
      priced >= 2
        ? `${priced} independent domains show pricing or checkout, without transaction or persistence evidence.`
        : `${priced} priced domain(s) supported by ${categoryOrAnalog} category/analog validation and ${traction ? 'transaction traction' : 'no traction'}.`;
  } else {
    band = 'LOW';
    reason =
      priced === 1
        ? 'A single domain with pricing and no transaction proxy or persistence.'
        : (summary.infraOnlyDomains ?? 0) >= 1
        ? 'Payment infrastructure detected; that proves the ability to charge, not that anyone pays.'
        : (sampled ?? 0) > 0
        ? `Sampled ${sampled} commercial target(s) and observed no pricing, checkout or revenue.`
        : 'Commercial intent in queries only; no observed supply.';
  }

  const pricingDecorationOnly =
    priced >= 2 && revenue === 0 && !traction && persistent === 0;

  const { strong, reasons } = resolveNegatives(summary, cfg);

  let downgraded = false;
  if (strong && band !== 'INSUFFICIENT' && band !== 'LOW') {
    downgraded = true;
    band = BAND_BELOW[band];
    reason = `${reason} Downgraded one band: ${reasons.join('; ')}.`;
  }

  const persistenceDaysNeeded =
    summary.persistenceDaysNeeded ??
    Math.max(0, cfg.persistenceDays - (summary.maxSnapshotSpanDays ?? 0));

  return {
    band,
    basisPoints: BASIS_BY_BAND[band],
    stage: resolveStage(summary, priced, persistent),
    pricingDecorationOnly,
    hasStrongNegative: strong,
    negativeReasons: reasons,
    downgraded,
    coverageInsufficient,
    persistenceDaysNeeded,
    reason,
  };
}
