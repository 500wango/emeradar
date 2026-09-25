import { runDailyPipeline } from './pipeline';
import { TrackRecordService } from '@emeradar/services';
import { closePool } from '@emeradar/db';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'run-daily';

  try {
    if (command === 'run-daily') {
      const date = args[1] || new Date().toISOString().slice(0, 10);
      console.log(`[cli] Executing daily pipeline for ${date}...`);
      const result = await runDailyPipeline(date);
      console.log('[cli] Result:', result);
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
    } else {
      console.log(`Unknown command: ${command}`);
      console.log('Available commands: run-daily [date], verify-ledger [date]');
    }
  } catch (err) {
    console.error('[cli] Command failed with error:', err);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
