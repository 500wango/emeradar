import { createHash } from 'node:crypto';
import { pool, closePool } from './client';

export interface SeedOpportunityDef {
  id: string;
  slug: string;
  title: string;
  primaryQuery: string;
  verdict: 'BUILD_NOW' | 'EARLY_BET';
  lifecycle: 'EARLY_WINDOW' | 'FORMING';
  recommendedArchetype: 'LIGHTWEIGHT_TOOL' | 'MICRO_SAAS' | 'DIRECTORY';
  executionClass: 'S' | 'M';
  dScore: number;
  mScore: number;
  wScore: number;
  dBand: 'HIGH';
  mBand: 'HIGH' | 'MEDIUM';
  wBand: 'HIGH';
  confidence: 'HIGH';
  whyNowSummary: string;
  topIdea: string;
  searchIntent: 'TRANSACTIONAL' | 'COMMERCIAL';
  recommendedProductShape: string;
  siteStrategy: 'INDEPENDENT_SITE';
  clusterQueries: string[];
  observedGateways: string[];
  serpResults: Array<{
    rank: number;
    url: string;
    domain: string;
    title: string;
    isWeak: boolean;
    weaknessReason?: string;
  }>;
}

const SEED_OPPORTUNITIES: SeedOpportunityDef[] = [
  {
    id: 'opp_stripe_dispute_compiler',
    slug: 'stripe-dispute-evidence-compiler',
    title: 'Stripe Dispute Evidence Auto-Compiler & Chargeback Defense',
    primaryQuery: 'stripe dispute evidence compiler',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    recommendedArchetype: 'MICRO_SAAS',
    executionClass: 'S',
    dScore: 8300,
    mScore: 8500,
    wScore: 7900,
    dBand: 'HIGH',
    mBand: 'HIGH',
    wBand: 'HIGH',
    confidence: 'HIGH',
    whyNowSummary: 'Stripe dispute fees escalated to $15 per chargeback in 2026. Top 10 organic SERP results are dominated by generic documentation pages and Reddit threads lacking a self-serve evidence PDF assembler.',
    topIdea: 'A lightweight webhook receiver that aggregates customer login timestamps, delivery tracking, and checkout TOS agreements into an official chargeback rebuttal package.',
    searchIntent: 'TRANSACTIONAL',
    recommendedProductShape: 'Micro-SaaS Webhook Integration & PDF Defense Hub',
    siteStrategy: 'INDEPENDENT_SITE',
    clusterQueries: [
      'stripe dispute evidence compiler',
      'how to win stripe chargeback dispute',
      'stripe chargeback evidence template pdf',
      'automated stripe dispute response tool',
    ],
    observedGateways: ['Stripe', 'Paddle'],
    serpResults: [
      { rank: 1, url: 'https://docs.stripe.com/disputes/responding', domain: 'stripe.com', title: 'Responding to disputes | Stripe Documentation', isWeak: true, weaknessReason: 'Generic documentation without downloadable assembler' },
      { rank: 2, url: 'https://reddit.com/r/stripe/comments/dispute_evidence', domain: 'reddit.com', title: 'How I won a $400 dispute on Stripe : r/stripe', isWeak: true, weaknessReason: 'Forum UGC discussion thread' },
      { rank: 3, url: 'https://chargeflow.io/blog/stripe-evidence', domain: 'chargeflow.io', title: 'Stripe Dispute Guide for High Volume Merchants', isWeak: true, weaknessReason: 'Enterprise $500/mo contract wall' },
      { rank: 4, url: 'https://medium.com/@dev/stripe-dispute-defense', domain: 'medium.com', title: '5 steps to defeat fraudulent chargebacks on Stripe', isWeak: true, weaknessReason: 'Outdated blog post (2023)' },
      { rank: 5, url: 'https://chargeblast.com', domain: 'chargeblast.com', title: 'Chargeblast Chargeback Mitigation Hub', isWeak: false },
    ],
  },
  {
    id: 'opp_podcast_transcript_seo',
    slug: 'podcast-transcript-seo-generator',
    title: 'Podcast Transcript to SEO Article & Show Notes Generator',
    primaryQuery: 'podcast transcript to seo article',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    recommendedArchetype: 'LIGHTWEIGHT_TOOL',
    executionClass: 'S',
    dScore: 8100,
    mScore: 7800,
    wScore: 8200,
    dBand: 'HIGH',
    mBand: 'HIGH',
    wBand: 'HIGH',
    confidence: 'HIGH',
    whyNowSummary: 'Apple Podcasts now automatically generates transcripts for all shows, unlocking massive audio text. Independent creators need direct transformation into search-optimized articles without paying $99/mo enterprise suites.',
    topIdea: 'Paste VTT/SRT transcript or RSS feed URL, extract timestamps and high-ranking FAQ schema, and download an index-ready Markdown blog post.',
    searchIntent: 'TRANSACTIONAL',
    recommendedProductShape: 'Lightweight Audio-to-Article Converter',
    siteStrategy: 'INDEPENDENT_SITE',
    clusterQueries: [
      'podcast transcript to seo article',
      'convert podcast transcript into blog post',
      'podcast show notes generator free',
      'audio transcript seo formatting tool',
    ],
    observedGateways: ['Stripe', 'LemonSqueezy'],
    serpResults: [
      { rank: 1, url: 'https://transistor.fm/blog/podcast-transcripts-seo', domain: 'transistor.fm', title: 'Do podcast transcripts help SEO? | Transistor', isWeak: true, weaknessReason: 'Educational guide without transformation tool' },
      { rank: 2, url: 'https://descript.com/tools/podcast-show-notes', domain: 'descript.com', title: 'Descript All-in-one Video & Audio Suite', isWeak: true, weaknessReason: 'Heavyweight desktop app requirement' },
      { rank: 3, url: 'https://podcastle.ai/blog/transcripts', domain: 'podcastle.ai', title: 'Repurposing podcast transcripts for web traffic', isWeak: true, weaknessReason: 'Shallow marketing blog article' },
      { rank: 4, url: 'https://castos.com/podcast-transcripts', domain: 'castos.com', title: 'Everything you need to know about transcripts', isWeak: true, weaknessReason: 'Hosting platform inner page' },
    ],
  },
  {
    id: 'opp_cron_deadman_monitor',
    slug: 'cron-job-deadman-webhook-monitor',
    title: 'Cron Job Health & Webhook Dead-Man Monitor',
    primaryQuery: 'cron job dead man switch monitor',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    recommendedArchetype: 'LIGHTWEIGHT_TOOL',
    executionClass: 'S',
    dScore: 8400,
    mScore: 7600,
    wScore: 8000,
    dBand: 'HIGH',
    mBand: 'HIGH',
    wBand: 'HIGH',
    confidence: 'HIGH',
    whyNowSummary: 'Solo builders deploying on Render, Railway, and Supabase lack simple heartbeat monitoring. Legacy enterprise solutions (PagerDuty, BetterStack) are bloated and charge per-seat.',
    topIdea: 'Zero-config heartbeat ping endpoint. Ping via curl on job finish; triggers instant Telegram, Discord, and email webhook alerts when a scheduled job fails to check in.',
    searchIntent: 'TRANSACTIONAL',
    recommendedProductShape: 'Single-Purpose Developer Monitor',
    siteStrategy: 'INDEPENDENT_SITE',
    clusterQueries: [
      'cron job dead man switch monitor',
      'simple cron heartbeat ping alert',
      'lightweight webhook monitor telegram',
      'supabase cron job health check',
    ],
    observedGateways: ['Stripe', 'Paddle'],
    serpResults: [
      { rank: 1, url: 'https://healthchecks.io/docs', domain: 'healthchecks.io', title: 'Healthchecks.io Cron Monitoring Docs', isWeak: false },
      { rank: 2, url: 'https://deadmanssnitch.com', domain: 'deadmanssnitch.com', title: 'Dead Man\'s Snitch: The monitoring tool for cron jobs', isWeak: true, weaknessReason: 'Dated 2018 UI with restrictive free tier' },
      { rank: 3, url: 'https://cronitor.io/cron-job-monitoring', domain: 'cronitor.io', title: 'Cronitor: Cron monitoring and APM', isWeak: false },
      { rank: 4, url: 'https://stackoverflow.com/questions/cron-monitoring', domain: 'stackoverflow.com', title: 'How to monitor scheduled tasks in Linux? - Stack Overflow', isWeak: true, weaknessReason: 'Q&A Forum thread' },
      { rank: 5, url: 'https://betterstack.com/community/guides/cron', domain: 'betterstack.com', title: 'Monitoring Cron Jobs with Shell Scripts', isWeak: true, weaknessReason: 'Generic tutorial inner page' },
    ],
  },
  {
    id: 'opp_nextjs_boilerplate_matrix',
    slug: 'nextjs-boilerplate-matrix',
    title: 'Next.js & Supabase SaaS Starter Matrix & Feature Comparator',
    primaryQuery: 'nextjs supabase saas starter comparison',
    verdict: 'EARLY_BET',
    lifecycle: 'FORMING',
    recommendedArchetype: 'DIRECTORY',
    executionClass: 'S',
    dScore: 7900,
    mScore: 6800,
    wScore: 8400,
    dBand: 'HIGH',
    mBand: 'MEDIUM',
    wBand: 'HIGH',
    confidence: 'HIGH',
    whyNowSummary: 'Over 50 paid Next.js boilerplates emerged in 2025-2026. Developers waste hours comparing features. Zero structured comparative directories exist; SERPs are cluttered with biased affiliate blog posts.',
    topIdea: 'An interactive feature matrix filtering by Auth (Supabase/Clerk/Auth0), Billing (Stripe/LemonSqueezy), UI library (Tailwind/Shadcn), and code license.',
    searchIntent: 'COMMERCIAL',
    recommendedProductShape: 'Curated Directory & Interactive Comparator',
    siteStrategy: 'INDEPENDENT_SITE',
    clusterQueries: [
      'nextjs supabase saas starter comparison',
      'best nextjs boilerplate 2026',
      'shipfast alternative nextjs starter',
      'open source nextjs saas template with stripe',
    ],
    observedGateways: ['Stripe', 'LemonSqueezy', 'Whop'],
    serpResults: [
      { rank: 1, url: 'https://github.com/topics/nextjs-boilerplate', domain: 'github.com', title: 'nextjs-boilerplate · GitHub Topics', isWeak: true, weaknessReason: 'Unfiltered code repository list' },
      { rank: 2, url: 'https://reddit.com/r/nextjs/comments/best_boilerplate', domain: 'reddit.com', title: 'Which NextJS boilerplate is actually worth it? : r/nextjs', isWeak: true, weaknessReason: 'Community forum discussion' },
      { rank: 3, url: 'https://dev.to/compare-nextjs-starters', domain: 'dev.to', title: 'A deep comparison of 5 popular Next.js starters in 2025', isWeak: true, weaknessReason: 'Individual developer blog post' },
    ],
  },
  {
    id: 'opp_pdf_privacy_redact',
    slug: 'pdf-privacy-redact-watermark-utility',
    title: 'Client-Side PDF Redaction & Watermark Removal Utility',
    primaryQuery: 'client side pdf redaction tool',
    verdict: 'EARLY_BET',
    lifecycle: 'EARLY_WINDOW',
    recommendedArchetype: 'LIGHTWEIGHT_TOOL',
    executionClass: 'S',
    dScore: 8600,
    mScore: 6500,
    wScore: 8500,
    dBand: 'HIGH',
    mBand: 'MEDIUM',
    wBand: 'HIGH',
    confidence: 'HIGH',
    whyNowSummary: 'Compliance and NDAs prevent builders and contractors from uploading confidential agreements to cloud converters (ILovePDF/SmallPDF). Exploding demand for zero-server WebAssembly tools.',
    topIdea: '100% in-browser WebAssembly PDF utility that removes watermarks and blacks out PII locally without transferring any document data to any server.',
    searchIntent: 'TRANSACTIONAL',
    recommendedProductShape: 'Client-Side Wasm Lightweight Tool',
    siteStrategy: 'INDEPENDENT_SITE',
    clusterQueries: [
      'client side pdf redaction tool',
      'offline pdf watermark remover browser',
      'redact confidential pdf without upload',
      'wasm pdf privacy tool',
    ],
    observedGateways: ['Stripe', 'LemonSqueezy'],
    serpResults: [
      { rank: 1, url: 'https://adobe.com/acrobat/online/redact-pdf.html', domain: 'adobe.com', title: 'Redact a PDF Online | Adobe Acrobat', isWeak: true, weaknessReason: 'Uploads files to Adobe Cloud and forces login' },
      { rank: 2, url: 'https://ilovepdf.com/redact-pdf', domain: 'ilovepdf.com', title: 'Redact PDF Online - 100% Private Tool', isWeak: true, weaknessReason: 'Server-side processing violates NDA mandates' },
      { rank: 3, url: 'https://news.ycombinator.com/item?id=pdf-wasm', domain: 'ycombinator.com', title: 'Show HN: In-browser PDF manipulation with WebAssembly', isWeak: true, weaknessReason: 'Hacker News thread' },
    ],
  },
  {
    id: 'opp_adsense_rpm_simulator',
    slug: 'adsense-rpm-revenue-simulator',
    title: 'AdSense Multi-Unit RPM Revenue Simulator & Layout Forecaster',
    primaryQuery: 'adsense rpm calculator by niche',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    recommendedArchetype: 'LIGHTWEIGHT_TOOL',
    executionClass: 'S',
    dScore: 8500,
    mScore: 7500,
    wScore: 8300,
    dBand: 'HIGH',
    mBand: 'HIGH',
    wBand: 'HIGH',
    confidence: 'HIGH',
    whyNowSummary: 'Google switched AdSense to impression-based payments (eCPM). Existing calculators rely on outdated 2020 CPC click models, failing content site creators needing accurate geographic RPM projections.',
    topIdea: 'Interactive simulator modeling revenue based on traffic tier (Tier 1 US/UK/CA vs Tier 3), pageview depth, layout ad density, and Core Web Vitals impact.',
    searchIntent: 'TRANSACTIONAL',
    recommendedProductShape: 'Interactive Publisher Calculator',
    siteStrategy: 'INDEPENDENT_SITE',
    clusterQueries: [
      'adsense rpm calculator by niche',
      'google adsense earnings calculator 2026',
      'website traffic revenue estimator per 1000 views',
      'adsense ecpm rates by country',
    ],
    observedGateways: ['Stripe', 'PayPal'],
    serpResults: [
      { rank: 1, url: 'https://google.com/adsense/start/calculator', domain: 'google.com', title: 'Google AdSense Revenue Calculator', isWeak: true, weaknessReason: 'Official simplified widget without niche or tier breakdowns' },
      { rank: 2, url: 'https://monetizemore.com/adsense-calculator', domain: 'monetizemore.com', title: 'AdSense Revenue Calculator - MonetizeMore', isWeak: true, weaknessReason: 'Gated lead-generation form' },
      { rank: 3, url: 'https://shoutmeloud.com/adsense-earnings-calculator', domain: 'shoutmeloud.com', title: 'How Much Can You Earn from Google AdSense?', isWeak: true, weaknessReason: 'Shallow 2021 tutorial article' },
    ],
  },
];

export async function seedRadarOpportunities(): Promise<void> {
  const client = await pool.connect();
  const obsDate = new Date().toISOString().slice(0, 10);
  console.log(`[seed-radar] Seeding high-conviction builder opportunities for ${obsDate}...`);

  try {
    await client.query('BEGIN');

    for (const opp of SEED_OPPORTUNITIES) {
      const queryId = `qry_${opp.slug.replace(/-/g, '_')}`;

      // 1. Insert queries
      await client.query(
        `INSERT INTO queries (id, query_text, market_country, research_language, first_seen_date, tier)
         VALUES ($1, $2, 'US', 'en-US', $3::date - INTERVAL '30 days', 'A')
         ON CONFLICT (id) DO UPDATE SET query_text = EXCLUDED.query_text`,
        [queryId, opp.primaryQuery, obsDate]
      );

      // 2. Insert opportunity with status = 'TRACKED'
      await client.query(
        `INSERT INTO opportunities (
           id, slug, title, status, market_country, research_language,
           first_observed_date, recommended_archetype, execution_class,
           discovery_source, discovered_at, candidate_reason
         ) VALUES ($1, $2, $3, 'TRACKED', 'US', 'en-US',
                   $4::date - INTERVAL '45 days', $5, $6,
                   'RADAR_DISCOVERY', NOW() - INTERVAL '45 days', 'High-confidence search cluster with confirmed commercial signals.')
         ON CONFLICT (id) DO UPDATE SET
           status = 'TRACKED',
           title = EXCLUDED.title,
           slug = EXCLUDED.slug,
           recommended_archetype = EXCLUDED.recommended_archetype,
           execution_class = EXCLUDED.execution_class`,
        [opp.id, opp.slug, opp.title, obsDate, opp.recommendedArchetype, opp.executionClass]
      );

      // 3. Link primary query
      await client.query(
        `INSERT INTO opportunity_queries (opportunity_id, query_id, role)
         VALUES ($1, $2, 'PRIMARY')
         ON CONFLICT (opportunity_id, query_id) DO UPDATE SET role = 'PRIMARY'`,
        [opp.id, queryId]
      );

      // 4. Seed 14+ days of autocomplete observations
      for (let dayOffset = 0; dayOffset <= 15; dayOffset++) {
        await client.query(
          `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions, depth)
           VALUES ($1, $2::date - ($3 || ' days')::interval, $4, 1)
           ON CONFLICT (query_id, observed_date) DO NOTHING`,
          [queryId, obsDate, String(dayOffset), opp.clusterQueries]
        );
      }

      // 5. Seed SERP snapshot & results
      const serpSnapshotId = `srp_${opp.id}_${obsDate.replace(/-/g, '')}`;
      await client.query(
        `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (query_id, obs_date) DO UPDATE SET weak_result_ratio = EXCLUDED.weak_result_ratio`,
        [serpSnapshotId, queryId, obsDate, 0.6]
      );

      await client.query(`DELETE FROM serp_results WHERE serp_snapshot_id = $1`, [serpSnapshotId]);
      for (const res of opp.serpResults) {
        await client.query(
          `INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title, snippet, result_type, is_weak, weakness_type)
           VALUES ($1, $2, $3, $4, $5, $6, 'ORGANIC', $7, $8)`,
          [
            serpSnapshotId,
            res.rank,
            res.url,
            res.domain,
            res.title,
            `${res.title} - observed organic ranking result`,
            res.isWeak,
            res.weaknessReason || null,
          ]
        );
      }

      // 6. Seed Commercial Evidence (Observed Stripe / LemonSqueezy)
      for (const gw of opp.observedGateways) {
        await client.query(
          `INSERT INTO evidence (opportunity_id, evidence_class, source_type, source_id, domain, title, snippet, payload, observed_at)
           VALUES ($1, 'OBSERVED', 'CHECKOUT_REFERRAL_RADAR', 'src_checkout_referral', $2, $3, $4, $5, NOW() - INTERVAL '5 days')`,
          [
            opp.id,
            `${opp.slug}.io`,
            `Verified ${gw} Checkout on ${opp.slug}.io`,
            `Active checkout session observed pointing to live ${gw} payment gateway.`,
            JSON.stringify({ gateway: gw, status: 'CONFIRMED_ACTIVE' }),
          ]
        );
      }

      // 7. Seed Opportunity Card
      await client.query(
        `INSERT INTO opportunity_cards (
           opportunity_id, slug, primary_query, verdict, lifecycle,
           d_basis_points, m_basis_points, w_basis_points,
           d_band, m_band, w_band, confidence,
           recommended_archetype, execution_class, why_now_summary, top_idea,
           first_observed_at, query_velocity, featured_evidence_snippet,
           search_intent, recommended_product_shape, site_strategy, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11, $12,
           $13, $14, $15, $16,
           NOW() - INTERVAL '45 days', 2.4, $17,
           $18, $19, $20, NOW()
         )
         ON CONFLICT (opportunity_id) DO UPDATE SET
           verdict = EXCLUDED.verdict,
           lifecycle = EXCLUDED.lifecycle,
           d_basis_points = EXCLUDED.d_basis_points,
           m_basis_points = EXCLUDED.m_basis_points,
           w_basis_points = EXCLUDED.w_basis_points,
           d_band = EXCLUDED.d_band,
           m_band = EXCLUDED.m_band,
           w_band = EXCLUDED.w_band,
           confidence = EXCLUDED.confidence,
           why_now_summary = EXCLUDED.why_now_summary,
           top_idea = EXCLUDED.top_idea,
           updated_at = NOW()`,
        [
          opp.id,
          opp.slug,
          opp.primaryQuery,
          opp.verdict,
          opp.lifecycle,
          opp.dScore,
          opp.mScore,
          opp.wScore,
          opp.dBand,
          opp.mBand,
          opp.wBand,
          opp.confidence,
          opp.recommendedArchetype,
          opp.executionClass,
          opp.whyNowSummary,
          opp.topIdea,
          `Verified ${opp.observedGateways.join(', ')} payment endpoints detected in active cluster.`,
          opp.searchIntent,
          opp.recommendedProductShape,
          opp.siteStrategy,
        ]
      );

      // 8. Seed Append-Only Verdict with cryptographic hashes
      const rowHash = createHash('sha256')
        .update(`${opp.id}|${obsDate}|${opp.verdict}|${opp.dScore}|${opp.mScore}|${opp.wScore}`)
        .digest('hex');
      const prevHash = createHash('sha256').update(`genesis_${opp.id}`).digest('hex');

      await client.query(
        `INSERT INTO verdicts (
           id, opportunity_id, obs_date, scoring_config_version,
           verdict, lifecycle, d_basis_points, m_basis_points, w_basis_points,
           confidence, input_snapshot_ids, cited_evidence_ids, prev_hash, row_hash
         ) VALUES (
           $1, $2, $3, 'sc-1.0.0',
           $4, $5, $6, $7, $8,
           $9, $10, $11, $12, $13
         )
         ON CONFLICT (opportunity_id, obs_date) DO NOTHING`,
        [
          `vdt_${opp.id}_${obsDate.replace(/-/g, '')}`,
          opp.id,
          obsDate,
          opp.verdict,
          opp.lifecycle,
          opp.dScore,
          opp.mScore,
          opp.wScore,
          opp.confidence,
          [`snp_${opp.id}_${obsDate}`],
          [],
          prevHash,
          rowHash,
        ]
      );
    }

    await client.query('COMMIT');
    console.log(`[seed-radar] Successfully seeded ${SEED_OPPORTUNITIES.length} high-conviction opportunities!`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed-radar] Error seeding opportunities:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedRadarOpportunities()
    .then(() => closePool())
    .catch((err) => {
      console.error(err);
      closePool();
      process.exit(1);
    });
}
