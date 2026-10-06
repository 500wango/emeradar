import {
  runDailyPipeline,
  discoverSources,
  generateDiscoveryIntents,
  validateDiscoveryIntents,
  generateExperimentCards,
  assessCommercialOpportunities,
  renderCommercialAssessment,
  TrackRecordService,
} from '@emeradar/services';
import { closePool, query } from '@emeradar/db';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'run-daily';

  try {
    if (command === 'run-daily') {
      const date = args[1] || new Date().toISOString().slice(0, 10);
      console.log(`[cli] Executing daily pipeline for ${date}...`);
      const result = await runDailyPipeline(date);
      console.log('[cli] Result:', result);
    } else if (command === 'discover') {
      console.log('[cli] Collecting new source signals...');
      const result = await discoverSources();
      console.log('[cli] Discovery result:', result);
      if (result.failed === result.sources && result.sources > 0) process.exitCode = 1;
    } else if (command === 'generate-intents') {
      const limit = Number(args[1] || 100);
      const created = await generateDiscoveryIntents(Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 100);
      console.log(`[cli] Generated ${created} unverified intent hypotheses.`);
    } else if (command === 'validate-intents') {
      const limit = Number(args[1] || 5);
      const validated = await validateDiscoveryIntents(Number.isFinite(limit) ? Math.max(1, Math.min(20, limit)) : 5);
      console.log(`[cli] Validated ${validated} discovery intent hypotheses.`);
    } else if (command === 'generate-experiments') {
      const created = await generateExperimentCards(Number(args[1] || 20));
      console.log(`[cli] Generated ${created} early experiment cards.`);
    } else if (command === 'sync-gsc') {
      const days = Math.max(1, Math.min(90, Number(args[1] || 30)));
      const end = new Date();
      end.setUTCDate(end.getUTCDate() - 2);
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - days + 1);
      const projects = await query<{ id: string; user_id: string }>(`SELECT p.id, p.user_id FROM projects p JOIN gsc_connections g ON g.project_id = p.id WHERE p.project_kind IN ('FORMAL','EXPERIMENT') AND p.status <> 'ARCHIVED' AND g.property_url IS NOT NULL`);
      let synced = 0;
      for (const project of projects.rows) {
        try {
          const result = await (await import('@emeradar/services')).ProjectService.syncGscProject(project.id, project.user_id, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
          synced++;
          console.log(`[cli] Synced ${project.id}: ${result.count} detail rows.`);
        } catch (error) {
          console.error(`[cli] GSC sync failed for ${project.id}:`, error);
        }
      }
      console.log(`[cli] GSC sync complete: ${synced}/${projects.rows.length} projects.`);
    } else if (command === 'verify-ledger') {
      const date = args[1] || new Date().toISOString().slice(0, 10);
      console.log(`[cli] Verifying cryptographic Merkle ledger for ${date}...`);
      const verification = await TrackRecordService.verifyCheckpoint(date);
      console.log('[cli] Verification result:', verification);
      if (verification.verified) {
        console.log('✅ Checkpoint Merkle Root matches 100% of underlying verdicts.');
      } else {
        console.error('❌ Checkpoint verification FAILED! Data corruption detected.');
        process.exit(1);
      }
    } else if (command === 'assess-commercial') {
      const date = args[1] || new Date().toISOString().slice(0, 10);
      console.log(`[cli] Re-banding the M-axis for ${date} (read-only, nothing is written)...`);
      const report = await assessCommercialOpportunities(date);
      console.log(renderCommercialAssessment(report));
    } else {
      console.log(`Unknown command: ${command}`);
      console.log('Available commands: run-daily [date], discover, generate-intents [limit], validate-intents [limit], generate-experiments [limit], sync-gsc [days], verify-ledger [date], assess-commercial [date]');
    }
  } catch (err) {
    console.error('[cli] Command failed with error:', err);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
