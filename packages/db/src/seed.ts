import { pool, closePool } from './client';

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
      ('FREE', 'Free Starter', 0.00, '{"view_cards_monthly": 10, "export_reports_monthly": 1, "max_projects": 1, "max_alerts": 1, "feed_delay_days": 45, "api_access": false}'),
      ('PRO', 'Builder Pro', 49.00, '{"view_cards_monthly": -1, "export_reports_monthly": 30, "max_projects": 10, "max_alerts": 20, "feed_delay_days": 0, "api_access": true}'),
      ('TEAM', 'Scale Team', 149.00, '{"view_cards_monthly": -1, "export_reports_monthly": 100, "max_projects": 50, "max_alerts": 100, "feed_delay_days": 0, "api_access": true}');
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

    await client.query('COMMIT');
    console.log('[seed] Accounts and sources seeded. Opportunity rows come from live observation, not from invented examples.');
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
