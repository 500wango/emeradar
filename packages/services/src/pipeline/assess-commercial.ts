import { query } from '@emeradar/db';
import { AxisBand, CommercialSummary, bandM } from '@emeradar/scoring';
import { buildCommercialRawSummary } from './commercial-assembly';

export interface CommercialAssessment {
  opportunityId: string;
  slug: string;
  status: string;
  storedVerdict: string;
  previousBand: AxisBand;
  previousBasisPoints: number;
  nextBand: AxisBand;
  nextBasisPoints: number;
  stage: string;
  independentPricedDomains: number;
  sampledDomains: number | null;
  sampleCoverage: number | null;
  persistenceDaysNeeded: number;
  hasStrongNegative: boolean;
  coverageInsufficient: boolean;
  buildNowGateSurvives: boolean | null;
  reason: string;
}

export interface CommercialAssessmentReport {
  obsDate: string;
  assessments: CommercialAssessment[];
  migrationMatrix: Record<string, number>;
  trackedBuildNow: number;
  trackedBuildNowLosingGate: number;
}

const BANDS: AxisBand[] = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'];

// Re-derives the BUILD_NOW M-gate from verdict.ts against the stored D/W/confidence,
// so the count reflects the rule change alone. Debounce is not simulated.
function buildNowGateSurvives(
  card: { d_band: string; w_band: string; confidence: string },
  summary: CommercialSummary,
  band: AxisBand,
  pricingDecorationOnly: boolean,
  hasStrongNegative: boolean
): boolean {
  const dGeMedium = card.d_band === 'HIGH' || card.d_band === 'MEDIUM';
  const wGeMedium = card.w_band === 'HIGH' || card.w_band === 'MEDIUM';
  const confGeMedium = card.confidence === 'HIGH' || card.confidence === 'MEDIUM';
  const traction = Boolean(summary.hasTransactionTraction);
  const persistent = summary.persistentPricedDomains ?? 0;

  const standard =
    band === 'HIGH' && (!pricingDecorationOnly || traction || persistent >= 1);
  const compensated =
    standard ||
    band === 'HIGH' ||
    (band === 'MEDIUM' && (summary.independentDomainsCount >= 2 || traction));

  return (
    !hasStrongNegative &&
    confGeMedium &&
    ((dGeMedium && standard && wGeMedium) ||
      (card.d_band === 'HIGH' && card.w_band === 'HIGH' && compensated))
  );
}

/**
 * Read-only: re-bands every opportunity card under the 07 §6.1 rules and reports the
 * migration. Writes nothing — the ledger for past dates stays as it was.
 */
export async function assessCommercialOpportunities(
  obsDate: string
): Promise<CommercialAssessmentReport> {
  const cards = await query<{
    id: string;
    slug: string;
    status: string;
    research_language: string;
    m_band: string;
    d_band: string;
    w_band: string;
    confidence: string;
    verdict: string;
    m_basis_points: number;
  }>(
    `SELECT o.id, o.slug, o.status, o.research_language,
            c.m_band, c.d_band, c.w_band, c.confidence, c.verdict, c.m_basis_points
     FROM opportunity_cards c
     JOIN opportunities o ON o.id = c.opportunity_id
     ORDER BY o.slug`
  );

  const assessments: CommercialAssessment[] = [];
  const migrationMatrix: Record<string, number> = {};
  let trackedBuildNow = 0;
  let trackedBuildNowLosingGate = 0;

  for (const card of cards.rows) {
    const raw = await buildCommercialRawSummary(card.id, obsDate, card.research_language);
    const result = bandM(raw);
    const key = `${card.m_band} -> ${result.band}`;
    migrationMatrix[key] = (migrationMatrix[key] ?? 0) + 1;

    const isTrackedBuildNow = card.status === 'TRACKED' && card.verdict === 'BUILD_NOW';
    const survives = isTrackedBuildNow
      ? buildNowGateSurvives(
          card,
          raw,
          result.band,
          result.pricingDecorationOnly,
          result.hasStrongNegative
        )
      : null;

    if (isTrackedBuildNow) {
      trackedBuildNow += 1;
      if (!survives) trackedBuildNowLosingGate += 1;
    }

    assessments.push({
      opportunityId: card.id,
      slug: card.slug,
      status: card.status,
      storedVerdict: card.verdict,
      previousBand: card.m_band as AxisBand,
      previousBasisPoints: Number(card.m_basis_points),
      nextBand: result.band,
      nextBasisPoints: result.basisPoints,
      stage: result.stage,
      independentPricedDomains: raw.independentPricedDomains ?? raw.independentDomainsCount,
      sampledDomains: raw.sampledDomains ?? null,
      sampleCoverage: raw.sampleCoverage ?? null,
      persistenceDaysNeeded: result.persistenceDaysNeeded,
      hasStrongNegative: result.hasStrongNegative,
      coverageInsufficient: result.coverageInsufficient,
      buildNowGateSurvives: survives,
      reason: result.reason,
    });
  }

  return { obsDate, assessments, migrationMatrix, trackedBuildNow, trackedBuildNowLosingGate };
}

export function renderCommercialAssessment(report: CommercialAssessmentReport): string {
  const lines: string[] = [
    `M-axis re-banding (read-only) for ${report.obsDate}`,
    `Opportunities assessed: ${report.assessments.length}`,
    '',
    'Band migration matrix:',
  ];

  for (const band of BANDS) {
    const row = report.assessments.filter((a) => a.previousBand === band);
    if (!row.length) continue;
    const counts = BANDS.map(
      (target) => `${target}:${row.filter((a) => a.nextBand === target).length}`
    );
    lines.push(`  ${band.padEnd(12)} ${counts.join('  ')}`);
  }

  lines.push(
    '',
    `TRACKED BUILD_NOW: ${report.trackedBuildNow}, losing the M gate under the new rules: ${report.trackedBuildNowLosingGate}`,
    ''
  );

  const demotions = report.assessments.filter(
    (a) => BANDS.indexOf(a.nextBand) > BANDS.indexOf(a.previousBand) || a.hasStrongNegative
  );
  if (demotions.length) {
    lines.push('Demoted or negatively flagged:');
    for (const a of demotions) {
      lines.push(
        `  ${a.slug}: ${a.previousBand} -> ${a.nextBand} (${a.stage}, priced ${a.independentPricedDomains}, sampled ${a.sampledDomains ?? 'n/a'}) ${a.reason}`
      );
    }
  }

  const coldStart = report.assessments.filter((a) => a.persistenceDaysNeeded > 0);
  if (coldStart.length) {
    lines.push('', `Persistence still to accumulate (07 §7), longest wait first:`);
    for (const a of coldStart
      .slice()
      .sort((x, y) => y.persistenceDaysNeeded - x.persistenceDaysNeeded)
      .slice(0, 10)) {
      lines.push(`  ${a.slug}: ${a.persistenceDaysNeeded} days remaining`);
    }
  }

  return lines.join('\n');
}
