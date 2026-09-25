import { pool, closePool } from './client';
import { generateDailyLedger, GENESIS_PREV_HASH, VerdictRowData } from '@emeradar/ledger';
import { generateOpportunityReport, renderReportToMarkdown } from '@emeradar/report';

export async function runSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log('[seed] Cleaning old records and starting fresh seed...');
    await client.query('BEGIN');

    // Clean tables in reverse dependency order
    await client.query(`
      TRUNCATE TABLE 
        public_pages,
        gsc_metrics_weekly,
        gsc_connections,
        projects,
        decisions,
        opportunity_reports,
        prediction_episodes,
        ledger_checkpoints,
        verdicts,
        kill_criteria,
        evidence,
        commercial_snapshots,
        commercial_targets,
        serp_results,
        serp_snapshots,
        autocomplete_observations,
        opportunity_cards,
        opportunity_snapshots,
        opportunity_queries,
        queries,
        entities,
        opportunities,
        collector_runs,
        sources,
        prompts,
        usage_counters,
        usage_events,
        subscriptions,
        plans,
        user_preferences,
        users
      CASCADE;
    `);

    // 1. Seed Plans
    console.log('[seed] Inserting Plans...');
    await client.query(`
      INSERT INTO plans (code, name, price_usd_monthly, entitlements) VALUES
      ('FREE', 'Free Starter', 0.00, '{"view_cards_monthly": 10, "export_reports_monthly": 1, "max_projects": 1, "max_alerts": 0, "api_access": false}'),
      ('PRO', 'Builder Pro', 49.00, '{"view_cards_monthly": -1, "export_reports_monthly": 30, "max_projects": 10, "max_alerts": 20, "api_access": true}'),
      ('TEAM', 'Scale Team', 149.00, '{"view_cards_monthly": -1, "export_reports_monthly": 100, "max_projects": 50, "max_alerts": 100, "api_access": true}');
    `);

    // 2. Seed Users
    console.log('[seed] Inserting Users...');
    await client.query(`
      INSERT INTO users (id, email, display_name, role, tier) VALUES
      ('usr_demo_free', 'free@emeradar.com', 'Alex Free', 'USER', 'FREE'),
      ('usr_demo_pro', 'pro@emeradar.com', 'Sarah Builder', 'USER', 'PRO'),
      ('usr_demo_admin', 'admin@emeradar.com', 'Michael Admin', 'ADMIN', 'TEAM');

      INSERT INTO user_preferences (user_id, ui_locale, preferred_build_types, preferred_markets, preferred_time_budget, onboarding_completed) VALUES
      ('usr_demo_free', 'en-US', '{"LIGHTWEIGHT_TOOL"}', '{"US"}', 'WEEKEND', true),
      ('usr_demo_pro', 'en-US', '{"LIGHTWEIGHT_TOOL","BOILERPLATE_SCAFFOLD"}', '{"US","UK"}', 'TWO_WEEKS', true),
      ('usr_demo_admin', 'zh-CN', '{"LIGHTWEIGHT_TOOL","MICRO_SAAS"}', '{"US"}', 'ONE_MONTH', true);

      INSERT INTO subscriptions (id, user_id, plan_code, status, current_period_start, current_period_end, entitlements_snapshot) VALUES
      ('sub_free', 'usr_demo_free', 'FREE', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days', '{"export_reports_monthly": 1}'),
      ('sub_pro', 'usr_demo_pro', 'PRO', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days', '{"export_reports_monthly": 30}'),
      ('sub_admin', 'usr_demo_admin', 'TEAM', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days', '{"export_reports_monthly": 100}');
    `);

    // 3. Seed Sources
    console.log('[seed] Inserting Sources...');
    await client.query(`
      INSERT INTO sources (id, type, name, tos_risk_level) VALUES
      ('src_google_autocomplete', 'AUTOCOMPLETE', 'Google Autocomplete Suggestions', 'LOW'),
      ('src_serp_google', 'SERP', 'Google Organic SERP Engine', 'LOW'),
      ('src_commercial_web', 'COMMERCIAL', 'Web Commercial & Pricing Scanner', 'LOW');
    `);

    // 4. Seed Prompts
    console.log('[seed] Inserting Prompts...');
    await client.query(`
      INSERT INTO prompts (id, key, version, template_hash, output_schema_ref, status) VALUES
      ('prm_sum_001', 'report_executive_summary', 1, '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff', 'schemas/report-summary-v1.json', 'ACTIVE');
    `);

    // 5. Seed Entities & Queries
    console.log('[seed] Inserting Entities & Queries...');
    await client.query(`
      INSERT INTO entities (id, canonical_name, category) VALUES
      ('ent_shopify', 'Shopify Ecosystem', 'E-COMMERCE'),
      ('ent_tailwind', 'Tailwind CSS', 'DEVELOPER_TOOLS'),
      ('ent_stripe', 'Stripe Billing', 'FINTECH'),
      ('ent_pdf', 'PDF Tools', 'PRODUCTIVITY'),
      ('ent_k8s', 'Kubernetes Cloud', 'DEVOPS');

      INSERT INTO queries (id, query_text, market_country, research_language, tier, entity_id) VALUES
      ('qry_sp_tax_01', 'shopify sales tax calculator', 'US', 'en-US', 'A', 'ent_shopify'),
      ('qry_sp_tax_02', 'shopify automatic nexus calculation', 'US', 'en-US', 'B', 'ent_shopify'),
      ('qry_tw_landing_01', 'tailwind landing page generator', 'US', 'en-US', 'A', 'ent_tailwind'),
      ('qry_tw_landing_02', 'tailwind micro saas components', 'US', 'en-US', 'B', 'ent_tailwind'),
      ('qry_st_leakage_01', 'stripe subscription leakage audit', 'US', 'en-US', 'A', 'ent_stripe'),
      ('qry_pdf_table_01', 'pdf to markdown table converter', 'US', 'en-US', 'A', 'ent_pdf'),
      ('qry_k8s_cost_01', 'kubernetes spot cost anomaly alert', 'US', 'en-US', 'A', 'ent_k8s');
    `);

    // 6. Seed Opportunities
    console.log('[seed] Inserting Opportunities...');
    const opps = [
      {
        id: 'opp_shopify_tax',
        slug: 'shopify-sales-tax-calculator',
        title: 'Shopify Sales Tax Calculator for Multi-State Vendors',
        status: 'TRACKED',
        archetype: 'LIGHTWEIGHT_TOOL',
        execClass: 'S',
        primaryQueryId: 'qry_sp_tax_01',
        primaryQueryText: 'shopify sales tax calculator',
        verdict: 'BUILD_NOW',
        lifecycle: 'EARLY_WINDOW',
        dBps: 8450,
        mBps: 7620,
        wBps: 8100,
        dBand: 'HIGH',
        mBand: 'HIGH',
        wBand: 'HIGH',
        confidence: 'HIGH',
        whyNow: 'Wayfair nexus enforcement tightening across 5 states in Q3 with existing tools paywalled above $50/mo.',
        topIdea: 'Free multi-state nexus & threshold calculator with CSV export and one-click Avalara/TaxJar comparison.',
        velocity: 1.45,
      },
      {
        id: 'opp_tailwind_landing',
        slug: 'tailwind-landing-page-generator',
        title: 'Tailwind CSS Micro-Landing Page Generator with One-Click Deploy',
        status: 'TRACKED',
        archetype: 'BOILERPLATE_SCAFFOLD',
        execClass: 'S',
        primaryQueryId: 'qry_tw_landing_01',
        primaryQueryText: 'tailwind landing page generator',
        verdict: 'BUILD_NOW',
        lifecycle: 'EARLY_WINDOW',
        dBps: 7920,
        mBps: 7200,
        wBps: 7550,
        dBand: 'HIGH',
        mBand: 'HIGH',
        wBand: 'HIGH',
        confidence: 'HIGH',
        whyNow: 'Tailwind v4 release caused breaking changes in legacy generators, creating an open 60-day migration window.',
        topIdea: 'Component-driven Tailwind landing page builder exporting clean TSX/HTML with zero runtime bloat.',
        velocity: 1.60,
      },
      {
        id: 'opp_stripe_leakage',
        slug: 'stripe-subscription-leakage-audit',
        title: 'Stripe Subscription Revenue Leakage & Inactive Churn Auditor',
        status: 'TRACKED',
        archetype: 'LIGHTWEIGHT_TOOL',
        execClass: 'M',
        primaryQueryId: 'qry_st_leakage_01',
        primaryQueryText: 'stripe subscription leakage audit',
        verdict: 'EARLY_BET',
        lifecycle: 'FORMING',
        dBps: 6800,
        mBps: 8400,
        wBps: 6200,
        dBand: 'MEDIUM',
        mBand: 'HIGH',
        wBand: 'MEDIUM',
        confidence: 'MEDIUM',
        whyNow: 'New Stripe dunning rules in 2026 creating billing confusion for sub-10k MRR bootstrappers.',
        topIdea: 'Read-only Stripe API analyzer flagging duplicate customer IDs, failed retries, and dunning gaps.',
        velocity: 1.15,
      },
      {
        id: 'opp_pdf_table_md',
        slug: 'pdf-to-markdown-table-converter',
        title: 'PDF Financial Statements to Markdown / CSV Table Extractor',
        status: 'TRACKED',
        archetype: 'LIGHTWEIGHT_TOOL',
        execClass: 'S',
        primaryQueryId: 'qry_pdf_table_01',
        primaryQueryText: 'pdf to markdown table converter',
        verdict: 'WATCH',
        lifecycle: 'CONTESTED',
        dBps: 6100,
        mBps: 5400,
        wBps: 5800,
        dBand: 'MEDIUM',
        mBand: 'MEDIUM',
        wBand: 'MEDIUM',
        confidence: 'MEDIUM',
        whyNow: 'LlamaParse and cloud vision models dominate, but strict corporate privacy bans cloud uploads.',
        topIdea: 'Client-side WASM PDF table extraction without uploading sensitive financial sheets to cloud servers.',
        velocity: 1.05,
      },
      {
        id: 'opp_k8s_cost_alert',
        slug: 'kubernetes-spot-cost-anomaly-alert',
        title: 'Kubernetes Spot Instance Cost Spikes Anomaly Detection Bot',
        status: 'TRACKED',
        archetype: 'EMBEDDED_EXTENSION',
        execClass: 'L',
        primaryQueryId: 'qry_k8s_cost_01',
        primaryQueryText: 'kubernetes spot cost anomaly alert',
        verdict: 'WINDOW_CLOSING',
        lifecycle: 'MATURE',
        dBps: 5200,
        mBps: 7100,
        wBps: 3800,
        dBand: 'MEDIUM',
        mBand: 'HIGH',
        wBand: 'LOW',
        confidence: 'MEDIUM',
        whyNow: 'Datadog and Kubecost recently released built-in spot anomaly alerts, closing standalone market entry.',
        topIdea: 'Slack bot alerting on cloud spot instance preemptions and sudden fallback to on-demand pricing.',
        velocity: 0.90,
      },
    ];

    for (const opp of opps) {
      await client.query(`
        INSERT INTO opportunities (id, slug, title, status, market_country, research_language, recommended_archetype, execution_class)
        VALUES ($1, $2, $3, $4, 'US', 'en-US', $5, $6);
      `, [opp.id, opp.slug, opp.title, opp.status, opp.archetype, opp.execClass]);

      await client.query(`
        INSERT INTO opportunity_queries (opportunity_id, query_id, role)
        VALUES ($1, $2, 'PRIMARY');
      `, [opp.id, opp.primaryQueryId]);

      // Opportunity Snapshot
      await client.query(`
        INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date, metrics)
        VALUES ($1, $2, CURRENT_DATE, $3);
      `, [
        `snp_${opp.id}_today`,
        opp.id,
        JSON.stringify({
          d_score: opp.dBps,
          m_score: opp.mBps,
          w_score: opp.wBps,
          velocity: opp.velocity,
        }),
      ]);

      // Materialized Opportunity Card
      await client.query(`
        INSERT INTO opportunity_cards (
          opportunity_id, slug, primary_query, verdict, lifecycle,
          d_basis_points, m_basis_points, w_basis_points,
          d_band, m_band, w_band, confidence,
          recommended_archetype, execution_class, why_now_summary, top_idea,
          first_observed_at, query_velocity
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16,
          NOW() - INTERVAL '30 days', $17
        );
      `, [
        opp.id,
        opp.slug,
        opp.primaryQueryText,
        opp.verdict,
        opp.lifecycle,
        opp.dBps,
        opp.mBps,
        opp.wBps,
        opp.dBand,
        opp.mBand,
        opp.wBand,
        opp.confidence,
        opp.archetype,
        opp.execClass,
        opp.whyNow,
        opp.topIdea,
        opp.velocity,
      ]);
    }

    // 7. Seed SERP Snapshots & Results for Primary Opportunities
    console.log('[seed] Inserting SERP Snapshots & Results...');
    await client.query(`
      INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio)
      VALUES ('srp_sp_01', 'qry_sp_tax_01', CURRENT_DATE, 0.60);

      INSERT INTO serp_results (serp_snapshot_id, rank, url, domain, title, snippet, result_type, is_weak, weakness_type) VALUES
      ('srp_sp_01', 1, 'https://reddit.com/r/shopify/comments/tax_help', 'reddit.com', 'How do you guys calculate state tax in Shopify?', 'Old forum discussion from 2023 with confusing advice...', 'UGC_THREAD', true, 'FORUM_OR_QA'),
      ('srp_sp_01', 2, 'https://old-ecommerce-blog.net/shopify-taxes', 'old-ecommerce-blog.net', 'Shopify Tax Rules (Updated 2021)', 'Outdated guide from 2021 without current threshold laws.', 'EDITORIAL_MEDIA', true, 'OUTDATED_CONTENT'),
      ('srp_sp_01', 3, 'https://affiliate-tools.io/best-tax-plugins', 'affiliate-tools.io', 'Top 5 Tax Software for Shopify Sellers', 'Affiliate comparison listicle with broken affiliate links.', 'LISTICLE_AFFILIATE', true, 'AFFILIATE_LISTICLE'),
      ('srp_sp_01', 4, 'https://avalara.com/us/en/products/shopify.html', 'avalara.com', 'Avalara AvaTax for Shopify Plus', 'Enterprise tax compliance starting at $500/month.', 'SPECIALIST', false, NULL),
      ('srp_sp_01', 5, 'https://community.shopify.com/c/accounting/sales-tax', 'shopify.com', 'Community question about multi-state registration', 'Unresolved question regarding Florida and Texas tax thresholds.', 'QA', true, 'FORUM_OR_QA');
    `);

    // 8. Seed Evidence
    console.log('[seed] Inserting Evidence Records...');
    await client.query(`
      INSERT INTO evidence (opportunity_id, evidence_class, source_type, domain, title, snippet, payload) VALUES
      ('opp_shopify_tax', 'OBSERVED', 'SERP', 'reddit.com', 'Reddit user thread searching for lightweight calculator', 'Looking for a simple tax calculation tool without paying $50/mo for TaxJar...', '{"upvotes": 42}'),
      ('opp_shopify_tax', 'OBSERVED', 'COMMERCIAL', 'taxjar.com', 'TaxJar Starter Pricing', 'Basic tier starts at $19/mo with strict 200 order limit.', '{"price_usd": 19}'),
      ('opp_shopify_tax', 'OBSERVED', 'AUTOCOMPLETE', 'google.com', 'High frequency autocomplete query', 'shopify sales tax calculator 2026', '{"volume_growth": "45%"}'),
      ('opp_tailwind_landing', 'OBSERVED', 'SERP', 'twitter.com', 'Tailwind v4 upgrade feedback', 'All old boilerplate landing page generators produce broken styles with Tailwind 4.', '{"likes": 128}');
    `);

    // 9. Seed Kill Criteria
    console.log('[seed] Inserting Kill Criteria...');
    await client.query(`
      INSERT INTO kill_criteria (id, opportunity_id, rule_code, predicate_dsl, description, status) VALUES
      ('kc_sp_01', 'opp_shopify_tax', 'KC-01', '{"event": "native_feature_release", "vendor": "Shopify"}', 'Shopify releases free built-in automatic multi-state calculation for all plan tiers', 'ACTIVE'),
      ('kc_sp_02', 'opp_shopify_tax', 'KC-02', '{"serp_weakness_lt": 0.20}', 'SERP weakness drops below 20% due to enterprise aggregators occupying top 3', 'ACTIVE'),
      ('kc_tw_01', 'opp_tailwind_landing', 'KC-01', '{"event": "official_templates_free"}', 'Tailwind Labs releases free official landing page visual builder', 'ACTIVE');
    `);

    // 10. Seed Prediction Ledger with Cryptographic Merkle Root
    console.log('[seed] Generating Merkle-hashed Verdicts and Checkpoint...');
    const verdictRows: { opportunityId: string; data: VerdictRowData }[] = opps.map((o) => ({
      opportunityId: o.id,
      data: {
        opportunityId: o.id,
        obsDate: '2026-09-25',
        scoringConfigVersion: 'sc-1.0.0',
        verdict: o.verdict as any,
        lifecycle: o.lifecycle as any,
        dBasisPoints: o.dBps,
        mBasisPoints: o.mBps,
        wBasisPoints: o.wBps,
        confidence: o.confidence as any,
        inputSnapshotIds: [`snp_${o.id}_today`],
        citedEvidenceIds: [],
      },
    }));

    const dailyLedger = generateDailyLedger(
      '2026-09-25',
      verdictRows,
      GENESIS_PREV_HASH,
      GENESIS_PREV_HASH
    );

    for (const row of dailyLedger.hashedRows) {
      await client.query(`
        INSERT INTO verdicts (
          id, opportunity_id, obs_date, scoring_config_version,
          verdict, lifecycle, d_basis_points, m_basis_points, w_basis_points,
          confidence, input_snapshot_ids, cited_evidence_ids,
          prev_hash, row_hash
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9,
          $10, $11, $12,
          $13, $14
        );
      `, [
        `vdt_${row.opportunityId}_20260925`,
        row.opportunityId,
        '2026-09-25',
        'sc-1.0.0',
        row.data.verdict,
        row.data.lifecycle,
        row.data.dBasisPoints,
        row.data.mBasisPoints,
        row.data.wBasisPoints,
        row.data.confidence,
        row.data.inputSnapshotIds,
        row.data.citedEvidenceIds,
        row.prevHash,
        row.rowHash,
      ]);
    }

    await client.query(`
      INSERT INTO ledger_checkpoints (
        id, obs_date, total_records, merkle_root, final_row_hash, signature
      ) VALUES (
        'ckp_20260925', '2026-09-25', $1, $2, $3, 'sig_ed25519_verified_sample'
      );
    `, [
      dailyLedger.summary.rowCount,
      dailyLedger.summary.merkleRoot,
      dailyLedger.summary.finalRowHash,
    ]);

    // 11. Seed Prediction Episodes for Historical Track Record
    console.log('[seed] Inserting Historical Prediction Episodes for Track Record...');
    await client.query(`
      INSERT INTO prediction_episodes (
        id, verdict_id, opportunity_id, published_verdict, predicted_at,
        evaluated_30d_at, outcome_30d, evaluated_60d_at, outcome_60d, evaluated_90d_at, outcome_90d, metrics
      ) VALUES
      ('eps_01', 'vdt_opp_shopify_tax_20260925', 'opp_shopify_tax', 'BUILD_NOW', '2026-06-25',
       '2026-07-25', 'HIT', '2026-08-25', 'HIT', '2026-09-25', 'HIT', '{"cluster_expansion": 2.4, "gsc_traction_impressions": 14200}'),
      ('eps_02', 'vdt_opp_tailwind_landing_20260925', 'opp_tailwind_landing', 'BUILD_NOW', '2026-07-10',
       '2026-08-10', 'HIT', '2026-09-10', 'HIT', NULL, 'PENDING', '{"cluster_expansion": 1.8, "gsc_traction_impressions": 8400}'),
      ('eps_03', 'vdt_opp_k8s_cost_alert_20260925', 'opp_k8s_cost_alert', 'WINDOW_CLOSING', '2026-08-01',
       '2026-09-01', 'HIT', NULL, 'PENDING', NULL, 'PENDING', '{"window_closed": true, "incumbent_entrants": 3}');
    `);

    // 12. Seed Opportunity Report for opp_shopify_tax
    console.log('[seed] Generating and saving Opportunity Report for opp_shopify_tax...');
    const reportData = generateOpportunityReport({
      reportId: 'rpt_sp_tax_01',
      opportunity: {
        id: 'opp_shopify_tax',
        title: 'Shopify Sales Tax Calculator for Multi-State Vendors',
        slug: 'shopify-sales-tax-calculator',
        marketCountry: 'US',
        researchLanguage: 'en-US',
      },
      scoring: {
        verdict: 'BUILD_NOW',
        rawVerdict: 'BUILD_NOW',
        lifecycle: 'EARLY_WINDOW',
        confidence: 'HIGH',
        confidenceScore: 0.88,
        dScore: 8450,
        mScore: 7620,
        wScore: 8100,
        dBand: 'HIGH',
        mBand: 'HIGH',
        wBand: 'HIGH',
        flags: [],
        explanation: {
          dReason: 'High query velocity (+45%) across 8 new queries in 7d',
          mReason: 'Paid competitors with Stripe Tax integration',
          wReason: 'Outdated blog posts and Reddit threads occupying top 3 search results',
          verdictReason: 'Strong D-M-W signals',
          rulesTriggered: ['RULE_BUILD_NOW'],
        },
        recommendedArchetype: 'LIGHTWEIGHT_TOOL',
        executionClass: 'S',
      },
      obsDate: '2026-09-25',
      primaryQuery: 'shopify sales tax calculator',
    });

    const reportMarkdown = renderReportToMarkdown(reportData);

    await client.query(`
      INSERT INTO opportunity_reports (
        id, opportunity_id, user_id, verdict_id, snapshot_id,
        locale, status, verdict, recommended_archetype,
        scores, content, content_markdown, export_count
      ) VALUES (
        'rpt_sp_tax_01', 'opp_shopify_tax', 'usr_demo_pro', 'vdt_opp_shopify_tax_20260925', 'snp_opp_shopify_tax_today',
        'en-US', 'READY', 'BUILD_NOW', 'LIGHTWEIGHT_TOOL',
        $1, $2, $3, 2
      );
    `, [
      JSON.stringify(reportData.metadata.scores),
      JSON.stringify(reportData),
      reportMarkdown,
    ]);

    // 13. Seed Decision & Project for Pro User
    console.log('[seed] Inserting User Decision & Project with GSC Metrics...');
    await client.query(`
      INSERT INTO decisions (id, opportunity_id, user_id, decision, verdict_id, reasons, channel)
      VALUES ('dcs_sp_01', 'opp_shopify_tax', 'usr_demo_pro', 'GO', 'vdt_opp_shopify_tax_20260925', '{"Strong SERP weakness","Fast weekend build"}', 'WEB');

      INSERT INTO projects (
        id, user_id, opportunity_id, decision_id, report_id,
        title, domain, build_type, status, launch_date, target_keywords
      ) VALUES (
        'prj_sp_tax_demo', 'usr_demo_pro', 'opp_shopify_tax', 'dcs_sp_01', 'rpt_sp_tax_01',
        'ShopiTax - Free Multi-State Tax Calculator', 'shopitax-calc.vercel.app',
        'LIGHTWEIGHT_TOOL', 'LAUNCHED', '2026-08-15',
        '{"shopify sales tax calculator","shopify nexus threshold tool","shopify sales tax free"}'
      );

      INSERT INTO gsc_metrics_weekly (project_id, week_start_date, impressions, clicks, average_position) VALUES
      ('prj_sp_tax_demo', '2026-08-18', 210, 8, 14.2),
      ('prj_sp_tax_demo', '2026-08-25', 680, 29, 9.8),
      ('prj_sp_tax_demo', '2026-09-01', 1420, 84, 6.4),
      ('prj_sp_tax_demo', '2026-09-08', 2900, 192, 4.1),
      ('prj_sp_tax_demo', '2026-09-15', 4850, 345, 3.2),
      ('prj_sp_tax_demo', '2026-09-22', 6320, 480, 2.7);
    `);

    // 14. Seed Public Track Record Page
    console.log('[seed] Inserting Public Pages...');
    await client.query(`
      INSERT INTO public_pages (id, slug, locale, page_type, status, content) VALUES
      ('pub_track_record', 'track-record', 'en-US', 'TRACK_RECORD', 'PUBLISHED', $1);
    `, [
      JSON.stringify({
        title: 'Emeradar Verified Track Record',
        description: 'Append-only Merkle ledger verifying search opportunity prediction outcomes.',
        totalPredictions: 48,
        winRate90d: '78.4%',
        activeCohortSize: 12,
      }),
    ]);

    await client.query('COMMIT');
    console.log('[seed] Database successfully seeded with high-fidelity commercial data!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] Seed failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runSeed()
    .then(() => {
      console.log('[seed] Done.');
      return closePool();
    })
    .catch(async (err) => {
      console.error('[seed] Execution error:', err);
      await closePool();
      process.exit(1);
    });
}
