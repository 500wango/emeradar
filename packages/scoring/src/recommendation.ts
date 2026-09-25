import {
  BuildArchetype,
  ExecutionClass,
  MonetizationRoute,
  RouteGrade,
} from '@emeradar/core';
import { AxisBand, CommercialSummary } from './types';

export interface RecommendationInput {
  queryTypes: {
    informationalRatio: number; // 0 - 1.0
    commercialRatio: number;
    transactionalRatio: number;
    toolModifierRatio: number; // calculator, generator, converter, etc.
    templateQueryCount: number;
    developerModifierRatio?: number;
  };
  serpWeakness: number;
  specialistToolCountInSerp: number;
  authoritativeInTop3: boolean;
  commercialSummary: CommercialSummary;
  dBand: AxisBand;
  wBand: AxisBand;
}

export interface ArchetypeScore {
  archetype: BuildArchetype;
  score: number;
  executionClass: ExecutionClass;
  rationale: string;
}

export interface MonetizationGrading {
  route: MonetizationRoute;
  tier: RouteGrade;
  notes: string;
}

export function evaluateRecommendations(input: RecommendationInput): {
  topArchetypes: ArchetypeScore[];
  monetizationRoutes: MonetizationGrading[];
  recommendedArchetype: BuildArchetype;
  recommendedExecutionClass: ExecutionClass;
} {
  const {
    queryTypes,
    serpWeakness,
    specialistToolCountInSerp,
    authoritativeInTop3,
    commercialSummary,
  } = input;

  const archetypes: ArchetypeScore[] = [];

  // 1. TOOL / LIGHTWEIGHT_TOOL
  let toolScore = 0;
  if (queryTypes.toolModifierRatio >= 0.3) toolScore += 30;
  if (specialistToolCountInSerp >= 2) toolScore += 20;
  if (serpWeakness >= 60) toolScore += 15;
  if (authoritativeInTop3) toolScore -= 20;
  archetypes.push({
    archetype: 'LIGHTWEIGHT_TOOL',
    score: toolScore,
    executionClass: 'S',
    rationale:
      'High tool-intent queries with addressable SERP weakness for standalone utilities.',
  });

  // 2. MICRO_SAAS
  let saasScore = 0;
  if (
    commercialSummary.independentDomainsCount >= 2 &&
    commercialSummary.hasSubscriptionPlans
  )
    saasScore += 30;
  if (queryTypes.commercialRatio >= 0.3) saasScore += 20;
  if (commercialSummary.band === 'HIGH' || commercialSummary.band === 'MEDIUM')
    saasScore += 10;
  if (commercialSummary.band === 'LOW' || commercialSummary.band === 'INSUFFICIENT')
    saasScore -= 15;
  archetypes.push({
    archetype: 'MICRO_SAAS',
    score: saasScore,
    executionClass: 'M',
    rationale:
      'Verified recurring commercial intent with multi-tier subscription headroom.',
  });

  // 3. PSEO_SITE
  let pseoScore = 0;
  if (queryTypes.templateQueryCount >= 20) pseoScore += 35;
  if (serpWeakness >= 60) pseoScore += 10;
  if (authoritativeInTop3) pseoScore -= 20;
  if (queryTypes.templateQueryCount < 8) pseoScore -= 30;
  archetypes.push({
    archetype: 'PSEO_SITE',
    score: pseoScore,
    executionClass: 'S',
    rationale:
      'High cluster templating suitable for programmatic landing pages.',
  });

  // 4. DIRECTORY
  let dirScore = 0;
  if (
    queryTypes.informationalRatio >= 0.4 &&
    queryTypes.toolModifierRatio >= 0.2
  )
    dirScore += 25;
  if (serpWeakness >= 50) dirScore += 15;
  archetypes.push({
    archetype: 'DIRECTORY',
    score: dirScore,
    executionClass: 'S',
    rationale:
      'List-based or marketplace search pattern with fragmented suppliers.',
  });

  // 5. CONTENT_SITE
  let contentScore = 0;
  if (queryTypes.informationalRatio >= 0.6) contentScore += 30;
  if (queryTypes.informationalRatio < 0.3) contentScore -= 20;
  archetypes.push({
    archetype: 'CONTENT_SITE',
    score: contentScore,
    executionClass: 'S',
    rationale:
      'Explanatory search intent with editorial monetization opportunities.',
  });

  // Sort descending by score
  archetypes.sort((a, b) => b.score - a.score);

  const top = archetypes[0] || {
    archetype: 'LIGHTWEIGHT_TOOL',
    score: 10,
    executionClass: 'S',
    rationale: 'Default agile lightweight utility implementation.',
  };

  // Monetization grading
  const monetizationRoutes: MonetizationGrading[] = [];

  // SaaS Subscription
  if (
    commercialSummary.independentDomainsCount >= 2 &&
    commercialSummary.hasSubscriptionPlans
  ) {
    monetizationRoutes.push({
      route: 'SAAS_SUBSCRIPTION',
      tier: 'PRIMARY',
      notes: `Verified subscription revenue: ${commercialSummary.independentDomainsCount} independent paid competitors observed.`,
    });
  } else if (commercialSummary.independentDomainsCount >= 1) {
    monetizationRoutes.push({
      route: 'SAAS_SUBSCRIPTION',
      tier: 'SECONDARY',
      notes:
        'Initial paid subscription presence observed; market depth requires validation.',
    });
  } else {
    monetizationRoutes.push({
      route: 'SAAS_SUBSCRIPTION',
      tier: 'NOT_RECOMMENDED',
      notes:
        'Commercial monetization unverified; no paid competitors found in SERP.',
    });
  }

  // Lead Gen
  if (queryTypes.commercialRatio >= 0.25) {
    monetizationRoutes.push({
      route: 'LEAD_GEN',
      tier: 'PRIMARY',
      notes: 'High commercial intent allows lucrative B2B referral or lead routing.',
    });
  } else {
    monetizationRoutes.push({
      route: 'LEAD_GEN',
      tier: 'SECONDARY',
      notes: 'Secondary monetization via partner referrals.',
    });
  }

  // Ads & Affiliate
  if (queryTypes.informationalRatio >= 0.5) {
    monetizationRoutes.push({
      route: 'ADS_AFFILIATE',
      tier: 'PRIMARY',
      notes:
        'High informational volume creates strong affiliate listicle and ad placement value.',
    });
  } else {
    monetizationRoutes.push({
      route: 'ADS_AFFILIATE',
      tier: 'SECONDARY',
      notes: 'Supportive ad/affiliate stream alongside primary offering.',
    });
  }

  // Developer API
  if ((queryTypes.developerModifierRatio ?? 0) >= 0.2) {
    monetizationRoutes.push({
      route: 'API_DEVELOPER',
      tier: 'PRIMARY',
      notes:
        'Developer query density indicates high API and headless tool demand.',
    });
  }

  return {
    topArchetypes: archetypes.slice(0, 3),
    monetizationRoutes,
    recommendedArchetype: top.archetype,
    recommendedExecutionClass: top.executionClass,
  };
}
