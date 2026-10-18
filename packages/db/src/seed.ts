import { pool, closePool } from './client';

export async function runSeed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:seed is disabled in production; use db:migrate for schema changes.');
  }

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
      INSERT INTO plans (code, name, price_usd_monthly, entitlements, is_active) VALUES
      ('FREE', 'Free Starter', 0.00, '{"api_access": false, "max_alerts": 0, "max_projects": 0, "feed_realtime": false, "live_scan_daily": 3, "view_cards_monthly": 10, "feed_selected_weekly": 1, "export_reports_monthly": 0, "generate_reports_monthly": 1}', true),
      ('STARTER', 'Starter', 49.00, '{"api_access": false, "max_alerts": 5, "pulse_radar": false, "max_projects": 3, "feed_realtime": true, "max_watchlist": 50, "live_scan_monthly": 10, "view_cards_monthly": -1, "history_window_days": 180, "max_gsc_connections": 3, "feed_selected_weekly": 0, "export_reports_monthly": 30, "atomic_go_export_monthly": 2, "generate_reports_monthly": 30}', true),
      ('PRO', 'Builder Pro', 29.00, '{"api_access": false, "max_alerts": 20, "pulse_radar": true, "max_projects": 50, "feed_realtime": true, "live_scan_daily": 30, "live_scan_monthly": 20, "view_cards_monthly": -1, "feed_selected_weekly": 0, "export_reports_monthly": 30, "atomic_go_export_monthly": 3, "generate_reports_monthly": 30}', true),
      ('TEAM', 'Scale Team', 149.00, '{"api_access": false, "max_alerts": 50, "max_projects": 100, "feed_realtime": true, "max_watchlist": 500, "live_scan_daily": 100, "live_scan_monthly": 50, "view_cards_monthly": -1, "feed_selected_weekly": 0, "export_reports_monthly": 100, "atomic_go_export_monthly": 15, "generate_reports_monthly": 100}', false);
    `);

    // 2. Seed Sources
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
    console.log('[seed] Catalog seeded. User accounts are created through registration, not seeded demo identities.');
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
