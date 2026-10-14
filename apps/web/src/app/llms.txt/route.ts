import { NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/seo/site';

export const dynamic = 'force-static';

const LLMS_TEXT = `# Emeradar

> Search Opportunity Intelligence & Commercial Signal Radar for Independent Software Builders.
> Website: ${SITE_URL}

Emeradar is an empirical search intelligence engine designed to validate micro-SaaS demand formation (D-Axis), commercial willingness-to-pay evidence (M-Axis), and SERP competitor vulnerability (W-Axis) before writing code. Candidates must clear all three gates to receive a "BUILD NOW" verdict.

## Core Capabilities
- **Demand Formation (D-Axis)**: Identifies emerging query clusters and search momentum before traditional SEO tools report search volume.
- **Commercial Willingness to Pay (M-Axis)**: Audits pricing tiers, checkout evidence, and actual transactional activity to ensure commercial viability.
- **SERP Vulnerability Window (W-Axis)**: Pinpoints thin content, outdated forum threads, and domain weakness across search engine results.
- **Verifiable Prediction Ledger**: 100% public accountability with 30-day cohort hit rates, archiving both hits and misses with Merkle proofs.
- **AI Scaffolding & Launch Kit**: Exportable code boilerplates, pain point breakdowns, and technical architecture plans for vetted opportunities.

## Methodology & Verdict Gates
1. **BUILD NOW**: D >= Threshold, M >= Threshold, W >= Threshold with verified multi-week trajectory.
2. **EARLY BET**: High demand velocity with early commercial proof; higher risk/return profile.
3. **WATCH**: Strong signal on 1-2 axes, pending commercial evidence or window opening.
4. **LOW**: Weak signals or incumbent moat; withheld from feed to prevent wasted builder effort.

## Pricing & Subscription Tiers
- **Free Tier ($0/month)**: 1 monthly full opportunity report, access to public archives, and verifiable prediction track record.
- **Builder Pro Monthly ($29/month)**: 30 monthly opportunity reports, zero-delay real-time signal radar feed, AI scaffolding launch kit, and competitor alerts.
- **Builder Pro Yearly ($290/year)**: Yearly subscription with 2 months free, real-time radar feed, automated alert tracking.
- **Builder Pro Lifetime ($590 one-time)**: Lifetime pass to Builder Pro workspace and real-time feeds.

## Key Public Resources
- [Homepage](${SITE_URL}/): Overview, live telemetry readings, and latest published opportunity signals.
- [Pricing](${SITE_URL}/pricing): Plan comparisons, quotas, and cancellation policy.
- [Methodology](${SITE_URL}/methodology): Formal 3-axis gating specification and evidence scoring axioms.
- [Verifiable Track Record](${SITE_URL}/track-record): Historical prediction ledger, cohort hit rates, and checkpoint hashes.
- [About & Team](${SITE_URL}/about): Mission, empirical principles, and research team identity.
- [Contact & Support](${SITE_URL}/contact): Engineering support, security vulnerability disclosures, and partnerships.
- [Privacy Policy](${SITE_URL}/privacy): Data protection practices, zero data selling guarantee, and user rights.
- [Terms of Service](${SITE_URL}/terms): Terms, usage policies, and subscription rules.
- [Sitemap](${SITE_URL}/sitemap.xml): Machine-readable XML sitemap.
`;

export function GET() {
  return new NextResponse(LLMS_TEXT, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
