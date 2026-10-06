import { query } from '@emeradar/db';
import {
  COMMERCIAL_DEFAULTS,
  CommercialConfig,
  CommercialSummary,
  SnapshotDiffFacts,
  classifySnapshotDiff,
  registrableDomain,
} from '@emeradar/scoring';
import { CommercialStage } from '@emeradar/core';

export interface CommercialFacts extends SnapshotDiffFacts {
  planNames: string[];
  gateways: string[];
  stage: CommercialStage;
}

export interface FetchFailureFacts {
  fetchStatus: 'FAILED' | 'ROBOTS_DISALLOWED' | 'BUDGET_SKIPPED' | 'BLOCKED_404';
}

const PRICED_SOURCE_TYPES = [
  'COMMERCIAL_CRAWL',
  'PAID_TIER_OBSERVED',
  'CHECKOUT_OBSERVED',
  'CHECKOUT_REFERRAL_RADAR',
];

const REVENUE_OBSERVED_TYPES = [
  'PLATFORM_COUNTER',
  'PLATFORM_REPORTED_REVENUE',
  'TRANSACTION_TRACTION_OBSERVED',
];

const COMMERCIAL_INTENT_WORDLIST: Record<string, string> = {
  en: '(price|pricing|cost|buy|cheap|subscription|alternative)',
  zh: '(价格|多少钱|订阅|购买|便宜|收费)',
};

function planFacts(plans: any[]): { count: number; paid: number; minPaid: number | null; names: string[] } {
  const list = Array.isArray(plans) ? plans : [];
  const paid = list.filter((p) => Number(p?.priceMonthly ?? 0) > 0);
  return {
    count: list.length,
    paid: paid.length,
    minPaid: paid.length ? Math.min(...paid.map((p) => Number(p.priceMonthly))) : null,
    names: list.map((p) => String(p?.name ?? 'plan')),
  };
}

/** Normalize a successful crawl into the facts the diffing and snapshot layer needs. */
export function factsFromCrawl(data: {
  obsDate: string;
  pricingPlans?: any[];
  paymentGateways?: string[];
  commercialStage?: string;
  fetchTier?: string;
  dynamicShell?: boolean;
}): CommercialFacts {
  const plans = data.pricingPlans ?? [];
  const gateways = data.paymentGateways ?? [];
  const f = planFacts(plans);
  return {
    obsDate: data.obsDate,
    plansCount: f.count,
    paidPlansCount: f.paid,
    minPaidPrice: f.minPaid,
    gatewaysCount: gateways.length,
    fetchTier: data.fetchTier === 'HEADLESS' ? 'HEADLESS' : 'STATIC',
    dynamicShell: Boolean(data.dynamicShell),
    fetchStatus: 'OK',
    planNames: f.names,
    gateways,
    stage: (data.commercialStage as CommercialStage) ?? (f.count > 0 ? 'PRICED' : gateways.length > 0 ? 'INFRA_PRESENT' : 'NONE'),
  };
}

function emptyFacts(obsDate: string, failure: FetchFailureFacts): CommercialFacts {
  return {
    obsDate,
    plansCount: 0,
    paidPlansCount: 0,
    minPaidPrice: null,
    gatewaysCount: 0,
    fetchTier: 'STATIC',
    dynamicShell: false,
    fetchStatus: failure.fetchStatus,
    planNames: [],
    gateways: [],
    stage: 'NONE',
  };
}

async function upsertTarget(domain: string, targetUrl: string): Promise<string> {
  const res = query<{ id: string }>(
    `INSERT INTO commercial_targets (id, domain, target_url, owner_group, last_crawled_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (domain) DO UPDATE
       SET last_crawled_at = NOW(),
           target_url = EXCLUDED.target_url,
           owner_group = COALESCE(commercial_targets.owner_group, EXCLUDED.owner_group)
     RETURNING id`,
    [
      `cmt_${domain.replace(/[^a-z0-9]/g, '_').slice(0, 48)}`,
      domain,
      targetUrl,
      registrableDomain(domain),
    ]
  );
  return (await res).rows[0]?.id ?? `cmt_${domain.replace(/[^a-z0-9]/g, '_').slice(0, 48)}`;
}

/**
 * Persist one observation per (target, day) — including empty and failed reads.
 * Without the empty rows, pricing removal and sampling coverage are not expressible
 * in the data at all (07 §7, §11 step 5).
 */
export async function writeCommercialSnapshot(
  opportunityId: string,
  domain: string,
  targetUrl: string,
  facts: CommercialFacts
): Promise<string> {
  const targetId = await upsertTarget(domain, targetUrl);

  await query(
    `INSERT INTO commercial_target_opportunities (commercial_target_id, opportunity_id)
     VALUES ($1, $2)
     ON CONFLICT (commercial_target_id, opportunity_id) DO NOTHING`,
    [targetId, opportunityId]
  );

  await query(
    `INSERT INTO commercial_snapshots
       (commercial_target_id, obs_date, pricing_plans, payment_gateways, commercial_stage,
        fetch_tier, fetch_status, dynamic_shell)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (commercial_target_id, obs_date) DO UPDATE SET
       pricing_plans = EXCLUDED.pricing_plans,
       payment_gateways = EXCLUDED.payment_gateways,
       commercial_stage = EXCLUDED.commercial_stage,
       fetch_tier = EXCLUDED.fetch_tier,
       fetch_status = EXCLUDED.fetch_status,
       dynamic_shell = EXCLUDED.dynamic_shell,
       created_at = NOW()`,
    [
      targetId,
      facts.obsDate,
      JSON.stringify(facts.planNames),
      facts.gateways,
      facts.stage,
      facts.fetchTier,
      facts.fetchStatus,
      facts.dynamicShell,
    ]
  );

  return targetId;
}

export async function writeFailedCommercialSnapshot(
  opportunityId: string,
  domain: string,
  targetUrl: string,
  obsDate: string,
  failure: FetchFailureFacts
): Promise<void> {
  await writeCommercialSnapshot(opportunityId, domain, targetUrl, emptyFacts(obsDate, failure));
}

/** A target with a successful read inside the window does not need to be re-crawled today. */
export async function hasFreshCommercialSnapshot(
  domain: string,
  obsDate: string,
  withinDays: number
): Promise<boolean> {
  const res = await query<{ one: number }>(
    `SELECT 1 AS one
     FROM commercial_snapshots cs
     JOIN commercial_targets ct ON ct.id = cs.commercial_target_id
     WHERE lower(ct.domain) = lower($1)
       AND cs.fetch_status = 'OK'
       AND cs.obs_date <= $2::date
       AND cs.obs_date > $2::date - $3::int
     LIMIT 1`,
    [domain, obsDate, withinDays]
  );
  return res.rows.length > 0;
}

async function lastOkFacts(targetId: string, obsDate: string): Promise<SnapshotDiffFacts | null> {
  const res = await query<{
    obs_date: string;
    pricing_plans: unknown;
    payment_gateways: string[];
    commercial_stage: string;
    fetch_tier: string;
    dynamic_shell: boolean;
    fetch_status: string;
  }>(
    `SELECT obs_date::text, pricing_plans, payment_gateways, commercial_stage,
            fetch_tier, dynamic_shell, fetch_status
     FROM commercial_snapshots
     WHERE commercial_target_id = $1 AND obs_date < $2::date AND fetch_status = 'OK'
     ORDER BY obs_date DESC
     LIMIT 1`,
    [targetId, obsDate]
  );
  const row = res.rows[0];
  if (!row) return null;
  // Historical rows only stored plan names, never prices, so the price delta cannot
  // be reconstructed from them; absence degrades to "no conclusion", never a negative.
  const names = Array.isArray(row.pricing_plans)
    ? (row.pricing_plans as unknown[]).map(String)
    : [];
  return {
    obsDate: row.obs_date,
    plansCount: names.length,
    paidPlansCount: names.length,
    minPaidPrice: null,
    gatewaysCount: row.payment_gateways?.length ?? 0,
    fetchTier: row.fetch_tier === 'HEADLESS' ? 'HEADLESS' : 'STATIC',
    dynamicShell: Boolean(row.dynamic_shell),
    fetchStatus: row.fetch_status,
  };
}

/**
 * 07 §11 step 5: diff today's read against the previous successful snapshot and
 * record removals as OBSERVED evidence. Suppression rules live in classifySnapshotDiff.
 */
export async function emitNegativesFromDiff(
  opportunityId: string,
  domain: string,
  targetId: string,
  obsDate: string,
  current: CommercialFacts,
  sourceId: string
): Promise<void> {
  const prior = await lastOkFacts(targetId, obsDate);
  if (!prior) return;
  const diff = classifySnapshotDiff(prior, current);

  const payload = {
    domain,
    prevObsDate: prior.obsDate,
    prevPlansCount: prior.plansCount,
    currentPlansCount: current.plansCount,
    prevPaidPlansCount: prior.paidPlansCount,
    currentPaidPlansCount: current.paidPlansCount,
    prevFetchTier: prior.fetchTier,
    currentFetchTier: current.fetchTier,
    suppressed: diff.suppressed ?? null,
    priceChangePct: diff.priceChangePct ?? null,
  };

  if (diff.negative) {
    await query(
      `INSERT INTO evidence (opportunity_id, evidence_class, source_type, source_id, domain, title, snippet, payload, observed_at)
       SELECT $1,'OBSERVED',$2,$3,$4,$5,$6,$7,NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM evidence
         WHERE opportunity_id = $1 AND source_type = $2
           AND lower(domain) = lower($4) AND observed_at::date = $8::date
       )`,
      [
        opportunityId,
        diff.negative,
        sourceId,
        domain,
        `${diff.negative} on ${domain}`,
        diff.negative === 'NEG_PRICING_REMOVED'
          ? `Pricing observed on ${prior.obsDate} is no longer present on ${obsDate}.`
          : `Paid plans observed on ${prior.obsDate} are free or absent on ${obsDate}.`,
        JSON.stringify(payload),
        obsDate,
      ]
    );
  }

  if (diff.priceChangeMajor) {
    await query(
      `INSERT INTO evidence (opportunity_id, evidence_class, source_type, source_id, domain, title, snippet, payload, observed_at)
       SELECT $1,'OBSERVED','PRICE_CHANGE_MAJOR',$2,$3,$4,$5,$6,NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM evidence
         WHERE opportunity_id = $1 AND source_type = 'PRICE_CHANGE_MAJOR'
           AND lower(domain) = lower($3) AND observed_at::date = $7::date
       )`,
      [
        opportunityId,
        sourceId,
        domain,
        `Major pricing change on ${domain}`,
        `Minimum paid price moved ${diff.priceChangePct}% between ${prior.obsDate} and ${obsDate}.`,
        JSON.stringify(payload),
        obsDate,
      ]
    );
  }
}

interface SpanRow {
  domain: string;
  first_ok: string;
  last_ok: string;
  ok_days: number;
  has_neg_removal: boolean;
}

async function domainSpans(
  opportunityId: string,
  obsDate: string,
  withinDays: number
): Promise<{ rows: SpanRow[] }> {
  return query<SpanRow>(
    `SELECT ct.domain,
            MIN(cs.obs_date)::text AS first_ok,
            MAX(cs.obs_date)::text AS last_ok,
            COUNT(DISTINCT cs.obs_date)::int AS ok_days,
            BOOL_OR(EXISTS (
              SELECT 1 FROM evidence neg
              WHERE neg.opportunity_id = $1
                AND lower(neg.domain) = lower(ct.domain)
                AND neg.source_type = 'NEG_PRICING_REMOVED'
                AND neg.observed_at::date BETWEEN cs.obs_date - $3::int AND cs.obs_date
            )) AS has_neg_removal
     FROM commercial_snapshots cs
     JOIN commercial_targets ct ON ct.id = cs.commercial_target_id
     JOIN commercial_target_opportunities cto ON cto.commercial_target_id = cs.commercial_target_id
     WHERE cto.opportunity_id = $1
       AND cs.obs_date <= $2::date
       AND cs.fetch_status = 'OK'
       AND cs.commercial_stage = 'PRICED'
     GROUP BY ct.domain`,
    [opportunityId, obsDate, withinDays]
  );
}

function distinctRoots(domains: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of domains) {
    const root = registrableDomain(d ?? '');
    if (root && !seen.has(root)) {
      seen.add(root);
      out.push(root);
    }
  }
  return out;
}

/** Build the 07 §5 contract from what the system has actually observed. */
export async function buildCommercialRawSummary(
  opportunityId: string,
  obsDate: string,
  researchLanguage: string,
  cfg: CommercialConfig = COMMERCIAL_DEFAULTS
): Promise<CommercialSummary> {
  const pricedRes = await query<{ id: string; domain: string }>(
    `SELECT e.id::text AS id, e.domain
     FROM evidence e
     WHERE e.opportunity_id = $1
       AND e.evidence_class = 'OBSERVED'
       AND e.observed_at::date <= $2::date
       AND e.observed_at::date > $2::date - $3::int
       AND e.source_type = ANY($4::text[])
       AND (
         e.source_type IN ('CHECKOUT_REFERRAL_RADAR','CHECKOUT_OBSERVED','PAID_TIER_OBSERVED')
         OR (CASE WHEN jsonb_typeof(e.payload->'plans') = 'array'
                  THEN jsonb_array_length(e.payload->'plans') ELSE 0 END) > 0
       )`,
    [opportunityId, obsDate, cfg.evidenceMaxAgeDays, PRICED_SOURCE_TYPES]
  );

  const infraRes = await query<{ domain: string }>(
    `SELECT DISTINCT e.domain
     FROM evidence e
     WHERE e.opportunity_id = $1
       AND e.evidence_class = 'OBSERVED'
       AND e.observed_at::date <= $2::date
       AND e.observed_at::date > $2::date - $3::int
       AND e.source_type IN ('COMMERCIAL_CRAWL','PAYMENT_INFRA_DETECTED')
       AND (CASE WHEN jsonb_typeof(e.payload->'plans') = 'array'
                 THEN jsonb_array_length(e.payload->'plans') ELSE 0 END) = 0
       AND (CASE WHEN jsonb_typeof(e.payload->'gateways') = 'array'
                 THEN jsonb_array_length(e.payload->'gateways') ELSE 0 END) > 0`,
    [opportunityId, obsDate, cfg.evidenceMaxAgeDays]
  );

  const coverageRes = await query<{ sampled: number; robots_excluded: number; total_targets: number }>(
    `WITH per_target AS (
       SELECT cto.commercial_target_id AS target_id,
              BOOL_OR(cs.fetch_status = 'OK' AND cs.obs_date <= $2::date
                                         AND cs.obs_date > $2::date - 30) AS sampled_30d,
              BOOL_OR(cs.fetch_status = 'ROBOTS_DISALLOWED') AS robots_blocked
       FROM commercial_target_opportunities cto
       LEFT JOIN commercial_snapshots cs ON cs.commercial_target_id = cto.commercial_target_id
       WHERE cto.opportunity_id = $1
       GROUP BY cto.commercial_target_id
     )
     SELECT COUNT(*) FILTER (WHERE sampled_30d)::int AS sampled,
            COUNT(*) FILTER (WHERE robots_blocked AND NOT sampled_30d)::int AS robots_excluded,
            COUNT(*)::int AS total_targets
     FROM per_target`,
    [opportunityId, obsDate]
  );

  const spans = await domainSpans(opportunityId, obsDate, cfg.evidenceMaxAgeDays);

  const negativesRes = await query<{ source_type: string; domains: number }>(
    `SELECT source_type, COUNT(DISTINCT lower(domain))::int AS domains
     FROM evidence
     WHERE opportunity_id = $1
       AND source_type LIKE 'NEG_%'
       AND observed_at::date <= $2::date
       AND observed_at::date > $2::date - $3::int
     GROUP BY source_type`,
    [opportunityId, obsDate, cfg.evidenceMaxAgeDays]
  );

  const intentRes = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM opportunity_queries oq
     JOIN queries q ON q.id = oq.query_id
     WHERE oq.opportunity_id = $1 AND LOWER(q.query_text) ~ $2`,
    [opportunityId, COMMERCIAL_INTENT_WORDLIST[researchLanguage.slice(0, 2)] ?? COMMERCIAL_INTENT_WORDLIST.en]
  );

  const revenueRes = await query<{ bucket: string; count: number }>(
    `SELECT CASE WHEN evidence_class = 'SELF_REPORTED' THEN 'self' ELSE 'observed' END AS bucket,
            COUNT(*)::int AS count
     FROM evidence
     WHERE opportunity_id = $1
       AND observed_at::date <= $2::date
       AND observed_at::date > $2::date - $3::int
       AND (
         (evidence_class = 'OBSERVED' AND source_type = ANY($4::text[]))
         OR (evidence_class = 'SELF_REPORTED'
             AND source_type IN ('SELF_REPORTED_REVENUE','SITE_CLAIMED_COUNTER'))
       )
     GROUP BY bucket`,
    [opportunityId, obsDate, cfg.evidenceMaxAgeDays, REVENUE_OBSERVED_TYPES]
  );

  const categoryRes = await query<{ count: number }>(
    `SELECT COUNT(DISTINCT lower(ct.domain))::int AS count
     FROM commercial_target_opportunities cto
     JOIN commercial_targets ct ON ct.id = cto.commercial_target_id
     WHERE cto.opportunity_id = $1
       AND cto.validation_level <> 'DIRECT'
       AND EXISTS (
         SELECT 1 FROM commercial_snapshots cs
         WHERE cs.commercial_target_id = cto.commercial_target_id
           AND cs.commercial_stage = 'PRICED' AND cs.fetch_status = 'OK'
       )`,
    [opportunityId]
  );

  const independentPricedDomains = distinctRoots(pricedRes.rows.map((r) => r.domain));
  const priced = independentPricedDomains.length;
  const infraOnly = distinctRoots(infraRes.rows.map((r) => r.domain)).filter(
    (root) => !independentPricedDomains.includes(root)
  ).length;

  const coverage = coverageRes.rows[0] ?? { sampled: 0, robots_excluded: 0, total_targets: 0 };
  // Before the first target is linked, the sampling denominator does not exist yet, so
  // coverage is not measurable rather than zero. bandM must not read that as INSUFFICIENT
  // and retire opportunities that already hold priced evidence.
  const measurable = coverage.total_targets > 0;
  const denominator = Math.max(1, coverage.total_targets - coverage.robots_excluded);
  const sampleCoverage = measurable ? coverage.sampled / denominator : undefined;

  let persistent = 0;
  let maxSpanDays = 0;
  for (const span of spans.rows) {
    const spanDays = Math.round(
      (new Date(span.last_ok).getTime() - new Date(span.first_ok).getTime()) / 86_400_000
    );
    maxSpanDays = Math.max(maxSpanDays, spanDays);
    if (span.ok_days >= 3 && spanDays >= cfg.persistenceDays && !span.has_neg_removal) persistent += 1;
  }

  const revenueBuckets = revenueRes.rows.reduce<Record<string, number>>(
    (acc, row) => ({ ...acc, [row.bucket]: row.count }),
    {}
  );

  const tractionRes = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM evidence
     WHERE opportunity_id = $1
       AND source_type IN ('TRANSACTION_TRACTION_OBSERVED','PLATFORM_COUNTER',
                           'PLATFORM_REPORTED_REVENUE','SOCIAL_COMMERCE_DISCUSSIONS')`,
    [opportunityId]
  );

  return {
    independentDomainsCount: priced,
    independentPricedDomains: priced,
    hasSubscriptionPlans: priced > 0,
    hasOneTimePlans: false,
    hasStrongNegative: false,
    totalScore: 0,
    band: 'INSUFFICIENT',
    asOf: obsDate,
    sampledDomains: measurable ? coverage.sampled : undefined,
    sampleCoverage: sampleCoverage === undefined ? undefined : Math.round(sampleCoverage * 1000) / 1000,
    persistentPricedDomains: persistent,
    maxSnapshotSpanDays: maxSpanDays,
    categoryOrAnalogPricedDomains: categoryRes.rows[0]?.count ?? 0,
    intentQueryCount: intentRes.rows[0]?.count ?? 0,
    infraOnlyDomains: infraOnly,
    revenueEvidence: {
      observed: revenueBuckets.observed ?? 0,
      selfReported: revenueBuckets.self ?? 0,
    },
    negatives: negativesRes.rows.map((row) => ({
      type: row.source_type,
      domains: row.domains,
      strong:
        row.source_type === 'NEG_SHUTDOWN_NOTICE' ||
        row.domains >= cfg.strongNegativeMinDomains,
    })),
    hasTransactionTraction: (tractionRes.rows[0]?.count ?? 0) > 0,
    contradictions: 0,
    evidenceIds: pricedRes.rows.map((r) => r.id),
  };
}
