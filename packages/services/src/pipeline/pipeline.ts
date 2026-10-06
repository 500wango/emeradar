import { query, transaction, getClient } from '@emeradar/db';
import {
  generateDailyLedger,
  GENESIS_PREV_HASH,
  VerdictRowData,
} from '@emeradar/ledger';
import {
  AutocompleteCollector,
  CostLedgerService,
  CrawlCollector,
  RunContext,
  SerpCollector,
} from '@emeradar/collectors';
import { observeOpportunity, ObservedOpportunity } from './observe-opportunity';
import { PublicPublicationService } from '../public-publication.service';
import { discoverAutocompleteCandidates } from './discover-candidates';

const PIPELINE_LOCK_ID = 481516;

export async function runDailyPipeline(obsDate = new Date().toISOString().slice(0, 10)): Promise<{
  processedOpportunities: number;
  merkleRoot: string;
  alertsTriggered: number;
}> {
  console.log(`[pipeline] Starting daily pipeline run for ${obsDate}...`);

  // Hold a dedicated pooled connection for the whole run so the session-level
  // advisory lock is reliably owned (and released) by the SAME connection.
  // Using pool.query() would check the lock in/out on random connections and
  // leak the lock, making the concurrency guard unreliable.
  const lockClient = await getClient();
  let lockAcquired = false;
  try {
    const lockRes = await lockClient.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) as locked`,
      [PIPELINE_LOCK_ID]
    );
    lockAcquired = Boolean(lockRes.rows[0]?.locked);
  } catch (err) {
    lockClient.release();
    throw err;
  }

  if (!lockAcquired) {
    console.warn(`[pipeline] Another pipeline process holds advisory lock ${PIPELINE_LOCK_ID}. Aborting.`);
    lockClient.release();
    const abortRunId = `run_${obsDate.replace(/-/g, '')}_${Date.now()}`;
    await query(
      `INSERT INTO pipeline_runs (id, obs_date, status, started_at, completed_at, error_message)
       VALUES ($1, $2, 'ABORTED', NOW(), NOW(), 'Advisory lock held by another process')`,
      [abortRunId, obsDate]
    ).catch(() => undefined);
    return { processedOpportunities: 0, merkleRoot: '', alertsTriggered: 0 };
  }

  const runId = `run_${obsDate.replace(/-/g, '')}_${Date.now()}`;
  const startTime = Date.now();
  await query(
    `INSERT INTO pipeline_runs (id, obs_date, status, started_at, metadata)
     VALUES ($1, $2, 'RUNNING', NOW(), $3)
     ON CONFLICT (id) DO NOTHING`,
    [runId, obsDate, JSON.stringify({ trigger: 'cli/cron' })]
  ).catch((e) => console.warn('[pipeline] Failed to record run start in pipeline_runs:', e));

  try {
    const budgetGuard = await CostLedgerService.createBudgetGuard(obsDate, 20.0);
    const runCtx: RunContext = {
      runId,
      obsDate,
      clock: () => new Date(),
      budget: budgetGuard,
    };

  const collectors = {
    autocomplete: new AutocompleteCollector(),
    serp: new SerpCollector(),
    crawl: new CrawlCollector(),
  };

  const discoveredCandidates = await discoverAutocompleteCandidates(obsDate);
  if (discoveredCandidates > 0) {
    console.log(`[pipeline] Discovered ${discoveredCandidates} emerging candidates from autocomplete.`);
  }

  const oppsRes = await query<{
    id: string;
    slug: string;
    title: string;
    market_country: string;
    research_language: string;
    recommended_archetype: string;
    execution_class: string;
    status: string;
  }>(
    `SELECT id, slug, title, market_country, research_language, recommended_archetype, execution_class, status
     FROM opportunities
     WHERE status IN ('CANDIDATE', 'TRACKED')
     ORDER BY id ASC`
  );

  const opps = oppsRes.rows;
  console.log(`[pipeline] Found ${opps.length} opportunities to observe.`);
  if (opps.length === 0) {
    return { processedOpportunities: 0, merkleRoot: '', alertsTriggered: 0 };
  }

  const existingCheckpoint = await query<{
    merkle_root: string;
    total_records: number;
  }>(
    `SELECT merkle_root, total_records FROM ledger_checkpoints WHERE obs_date = $1`,
    [obsDate]
  );
  if (existingCheckpoint.rows[0]) {
    return {
      processedOpportunities: 0,
      merkleRoot: existingCheckpoint.rows[0].merkle_root,
      alertsTriggered: 0,
    };
  }

  const observed: ObservedOpportunity[] = [];
  for (const opp of opps) {
    const row = await observeOpportunity(opp, obsDate, runCtx, collectors);
    if (row) observed.push(row);
  }

  const publishable = observed.filter((item) => item.publishable);
  const prevCkpRes = await query<{ final_row_hash: string; checkpoint_hash: string | null }>(
    `SELECT final_row_hash, checkpoint_hash FROM ledger_checkpoints WHERE obs_date < $1 ORDER BY obs_date DESC LIMIT 1`,
    [obsDate]
  );
  const prevRowHash = prevCkpRes.rows[0]?.final_row_hash || GENESIS_PREV_HASH;
  const prevCheckpointHash = prevCkpRes.rows[0]?.checkpoint_hash || prevRowHash;

  const ledgerRows = publishable.map((item) => {
    const rowData: VerdictRowData = {
      opportunityId: item.opportunityId,
      obsDate,
      scoringConfigVersion: 'sc-1.0.0',
      verdict: item.output.verdict,
      lifecycle: item.output.lifecycle,
      dBasisPoints: item.output.dScore,
      mBasisPoints: item.output.mScore,
      wBasisPoints: item.output.wScore,
      confidence: item.output.confidence,
      inputSnapshotIds: [`snp_${item.opportunityId}_${obsDate}`],
      citedEvidenceIds: [],
    };
    return { opportunityId: item.opportunityId, data: rowData };
  });

  const dailyLedger =
    ledgerRows.length > 0
      ? generateDailyLedger(obsDate, ledgerRows, prevCheckpointHash, prevRowHash)
      : null;

  let alertsTriggered = 0;
  const pendingEmails: Array<{ to: string; subject: string; body: string }> = [];

  await transaction(async (client) => {
    for (const item of observed) {
      const originalOpp = opps.find((o) => o.id === item.opportunityId);
      const isAlreadyTracked = originalOpp?.status === 'TRACKED';

      // If already tracked and current pipeline run did not pass automated publication
      // (e.g. transient external provider error or missing API key), preserve verified scores
      if (isAlreadyTracked && !item.publishable) {
        console.log(`[pipeline] Preserving manually tracked opportunity ${item.opportunityId} (${item.slug}) from automatic downgrade.`);
        continue;
      }

      await client.query(
        `UPDATE opportunity_cards SET
           verdict = $2,
           lifecycle = $3,
           d_basis_points = $4,
           m_basis_points = $5,
           w_basis_points = $6,
           d_band = $7,
           m_band = $8,
           w_band = $9,
           confidence = $10,
           why_now_summary = $11,
           top_idea = $12,
           updated_at = NOW()
         WHERE opportunity_id = $1`,
        [
          item.opportunityId,
          item.output.verdict,
          item.output.lifecycle,
          item.output.dScore,
          item.output.mScore,
          item.output.wScore,
          item.output.dBand,
          item.output.mBand,
          item.output.wBand,
          item.output.confidence,
          item.whyNowSummary,
          item.topIdea,
        ]
      );
      const targetStatus = isAlreadyTracked ? 'TRACKED' : (item.publishable ? 'TRACKED' : 'CANDIDATE');
      await client.query(`UPDATE opportunities SET status = $2 WHERE id = $1`, [
        item.opportunityId,
        targetStatus,
      ]);
    }

    if (dailyLedger) {
      for (const row of dailyLedger.hashedRows) {
        await client.query(
          `INSERT INTO verdicts (
            id, opportunity_id, obs_date, scoring_config_version,
            verdict, lifecycle, d_basis_points, m_basis_points, w_basis_points,
            confidence, input_snapshot_ids, cited_evidence_ids, prev_hash, row_hash
          ) VALUES (
            $1,$2,$3,'sc-1.0.0',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
          )
          ON CONFLICT (opportunity_id, obs_date) DO NOTHING`,
          [
            `vdt_${row.opportunityId}_${obsDate.replace(/-/g, '')}`,
            row.opportunityId,
            obsDate,
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
          ]
        );
      }

      await client.query(
        `INSERT INTO ledger_checkpoints (id, obs_date, total_records, merkle_root, final_row_hash, checkpoint_hash, signature)
         VALUES ($1,$2,$3,$4,$5,$6,'unsigned')
         ON CONFLICT (obs_date) DO NOTHING`,
        [
          `ckp_${obsDate.replace(/-/g, '')}`,
          obsDate,
          dailyLedger.summary.rowCount,
          dailyLedger.summary.merkleRoot,
          dailyLedger.summary.finalRowHash,
          dailyLedger.summary.checkpointHash,
        ]
      );
    }

    const rulesRes = await client.query<{
      id: string;
      user_id: string;
      opportunity_id: string;
      email: string;
    }>(
      `SELECT r.id, r.user_id, r.opportunity_id, u.email
       FROM alert_rules r
       JOIN users u ON u.id = r.user_id
       WHERE r.is_active = true AND r.rule_type = 'VERDICT_CHANGE'`
    );

    for (const rule of rulesRes.rows) {
      const match = publishable.find(
        (item) =>
          item.opportunityId === rule.opportunity_id &&
          item.previousVerdict &&
          item.previousVerdict !== item.output.verdict
      );
      if (!match) continue;
      const title = `Verdict changed: ${match.title}`;
      const body = `${match.primaryQuery} moved from ${match.previousVerdict} to ${match.output.verdict}. ${match.whyNowSummary}`;
      await client.query(
        `INSERT INTO notifications (id, user_id, title, body, opportunity_id)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [`ntf_${obsDate}_${rule.id}`, rule.user_id, title, body, rule.opportunity_id]
      );
      alertsTriggered++;
      pendingEmails.push({ to: rule.email, subject: title, body });
    }
  });

  for (const email of pendingEmails) {
    await deliverAlertEmail(email.to, email.subject, email.body);
  }

  for (const item of observed) {
    await PublicPublicationService.publishOpportunity(item.opportunityId).catch((error) => {
      console.warn(`[pipeline] public projection skipped for ${item.opportunityId}:`, error instanceof Error ? error.message : error);
    });
  }

  console.log(
    `[pipeline] Observed ${observed.length}. Published ${publishable.length}. Alerts ${alertsTriggered}.`
  );
  const durationMs = Date.now() - startTime;
    await query(
      `UPDATE pipeline_runs SET
         status = 'COMPLETED',
         completed_at = NOW(),
         duration_ms = $1,
         processed_opportunities = $2,
         merkle_root = $3,
         alerts_triggered = $4
       WHERE id = $5`,
      [
        durationMs,
        observed.length,
        dailyLedger?.summary.merkleRoot || '',
        alertsTriggered,
        runId,
      ]
    ).catch((e) => console.warn('[pipeline] Failed to record run completion in pipeline_runs:', e));

    return {
      processedOpportunities: observed.length,
      merkleRoot: dailyLedger?.summary.merkleRoot || '',
      alertsTriggered,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    await query(
      `UPDATE pipeline_runs SET
         status = 'FAILED',
         completed_at = NOW(),
         duration_ms = $1,
         error_message = $2
       WHERE id = $3`,
      [durationMs, err?.message || String(err), runId]
    ).catch((e) => console.warn('[pipeline] Failed to record run failure in pipeline_runs:', e));
    throw err;
  } finally {
    await lockClient.query(`SELECT pg_advisory_unlock($1)`, [PIPELINE_LOCK_ID]).catch(() => undefined);
    lockClient.release();
  }
}

async function deliverAlertEmail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;
  if (!key || !from || !to) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  }).catch(() => undefined);
}
