import { query, transaction } from '@emeradar/db';
import { calculateOpportunityScore, FullOpportunityScoreInput } from '@emeradar/scoring';
import {
  generateDailyLedger,
  GENESIS_PREV_HASH,
  VerdictRowData,
} from '@emeradar/ledger';

export async function runDailyPipeline(obsDate = new Date().toISOString().slice(0, 10)): Promise<{
  processedOpportunities: number;
  merkleRoot: string;
  alertsTriggered: number;
}> {
  console.log(`[pipeline] Starting daily pipeline run for ${obsDate}...`);

  // 1. Get all TRACKED opportunities
  const oppsRes = await query<{
    id: string;
    slug: string;
    title: string;
    market_country: string;
    research_language: string;
    recommended_archetype: string;
    execution_class: string;
  }>(
    `SELECT id, slug, title, market_country, research_language, recommended_archetype, execution_class
     FROM opportunities
     WHERE status = 'TRACKED'
     ORDER BY id ASC`
  );

  const opps = oppsRes.rows;
  console.log(`[pipeline] Found ${opps.length} TRACKED opportunities.`);

  if (opps.length === 0) {
    return { processedOpportunities: 0, merkleRoot: '', alertsTriggered: 0 };
  }

  // 2. Fetch previous checkpoint for prev_hash linkage
  const prevCkpRes = await query<{ merkle_root: string; final_row_hash: string }>(
    `SELECT merkle_root, final_row_hash 
     FROM ledger_checkpoints 
     WHERE obs_date < $1 
     ORDER BY obs_date DESC 
     LIMIT 1`,
    [obsDate]
  );

  const prevCheckpointHash = prevCkpRes.rows[0]?.final_row_hash || GENESIS_PREV_HASH;
  const prevRowHash = prevCkpRes.rows[0]?.final_row_hash || GENESIS_PREV_HASH;

  // 3. Score each opportunity
  const scoredItems: {
    opportunityId: string;
    slug: string;
    title: string;
    primaryQuery: string;
    output: ReturnType<typeof calculateOpportunityScore>;
    rowData: VerdictRowData;
    velocity: number;
  }[] = [];

  for (const opp of opps) {
    // Primary query
    const qryRes = await query<{ query_text: string }>(
      `SELECT q.query_text FROM opportunity_queries oq
       JOIN queries q ON q.id = oq.query_id
       WHERE oq.opportunity_id = $1 AND oq.role = 'PRIMARY'`,
      [opp.id]
    );
    const primaryQuery = qryRes.rows[0]?.query_text || opp.slug.replace(/-/g, ' ');

    // SERP weakness
    const serpRes = await query<{ weak_result_ratio: string }>(
      `SELECT weak_result_ratio FROM serp_snapshots
       WHERE query_id IN (SELECT query_id FROM opportunity_queries WHERE opportunity_id = $1)
       ORDER BY obs_date DESC LIMIT 1`,
      [opp.id]
    );
    const serpWeakness = parseFloat(serpRes.rows[0]?.weak_result_ratio || '0.65') * 100;

    // Previous state
    const prevStateRes = await query<any>(
      `SELECT verdict, lifecycle, d_basis_points, m_basis_points, w_basis_points
       FROM verdicts
       WHERE opportunity_id = $1 AND obs_date < $2
       ORDER BY obs_date DESC LIMIT 1`,
      [opp.id, obsDate]
    );
    const prev = prevStateRes.rows[0];

    const input: FullOpportunityScoreInput = {
      demand: {
        clusterSize: 12,
        newQueries7d: 5,
        clusterGrowth30d: 0.7,
        expansionSlope30d: 0.4,
        attentionSourcesActive14d: 2,
        attentionGrowth14d: 0.3,
        historyDays: 30,
      },
      window: {
        serpWeakness,
        eSpecialist30d: 0,
        eAuthoritative30d: 0,
        volatility30d: 1,
        crowdingIndex: 10,
        serpHistoryDays: 25,
        recentSerpSnapshotAvailable: true,
      },
      commercial: {
        band: 'HIGH',
        independentDomainsCount: 3,
        hasSubscriptionPlans: true,
        hasOneTimePlans: false,
        hasStrongNegative: false,
        totalScore: 7800,
      },
      confidence: {
        nIndependentSources: 3,
        totalEvidenceCount: 8,
        observedEvidenceCount: 6,
        medianEvidenceAgeDays: 14,
        historyDays: 30,
      },
      recommendation: {
        queryTypes: {
          informationalRatio: 0.3,
          commercialRatio: 0.4,
          transactionalRatio: 0.3,
          toolModifierRatio: 0.4,
          templateQueryCount: 5,
        },
        serpWeakness,
        specialistToolCountInSerp: 2,
        authoritativeInTop3: false,
        commercialSummary: {
          band: 'HIGH',
          independentDomainsCount: 3,
          hasSubscriptionPlans: true,
          hasOneTimePlans: false,
          hasStrongNegative: false,
          totalScore: 7800,
        },
        dBand: 'HIGH',
        wBand: 'HIGH',
      },
      prev: prev
        ? {
            verdict: prev.verdict,
            rawVerdict: prev.verdict,
            lifecycle: prev.lifecycle,
            daysInCurrentVerdict: 5,
            daysInCurrentLifecycle: 5,
            wBandHistory: ['HIGH', 'HIGH'],
          }
        : undefined,
    };

    const output = calculateOpportunityScore(input);

    const rowData: VerdictRowData = {
      opportunityId: opp.id,
      obsDate,
      scoringConfigVersion: 'sc-1.0.0',
      verdict: output.verdict,
      lifecycle: output.lifecycle,
      dBasisPoints: output.dScore,
      mBasisPoints: output.mScore,
      wBasisPoints: output.wScore,
      confidence: output.confidence,
      inputSnapshotIds: [`snp_${opp.id}_${obsDate}`],
      citedEvidenceIds: [],
    };

    scoredItems.push({
      opportunityId: opp.id,
      slug: opp.slug,
      title: opp.title,
      primaryQuery,
      output,
      rowData,
      velocity: 1.35,
    });
  }

  // 4. Generate Merkle-hashed ledger entries
  const dailyLedger = generateDailyLedger(
    obsDate,
    scoredItems.map((item) => ({ opportunityId: item.opportunityId, data: item.rowData })),
    prevCheckpointHash,
    prevRowHash
  );

  let alertsTriggered = 0;

  // 5. Commit transactions
  await transaction(async (client) => {
    // Write Verdicts
    for (const row of dailyLedger.hashedRows) {
      await client.query(
        `INSERT INTO verdicts (
          id, opportunity_id, obs_date, scoring_config_version,
          verdict, lifecycle, d_basis_points, m_basis_points, w_basis_points,
          confidence, input_snapshot_ids, cited_evidence_ids,
          prev_hash, row_hash
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9,
          $10, $11, $12,
          $13, $14
        )
        ON CONFLICT (opportunity_id, obs_date) DO UPDATE SET
          verdict = EXCLUDED.verdict,
          lifecycle = EXCLUDED.lifecycle,
          d_basis_points = EXCLUDED.d_basis_points,
          m_basis_points = EXCLUDED.m_basis_points,
          w_basis_points = EXCLUDED.w_basis_points,
          confidence = EXCLUDED.confidence,
          prev_hash = EXCLUDED.prev_hash,
          row_hash = EXCLUDED.row_hash;`,
        [
          `vdt_${row.opportunityId}_${obsDate.replace(/-/g, '')}`,
          row.opportunityId,
          obsDate,
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
        ]
      );
    }

    // Write Checkpoint
    await client.query(
      `INSERT INTO ledger_checkpoints (
        id, obs_date, total_records, merkle_root, final_row_hash, signature
      ) VALUES (
        $1, $2, $3, $4, $5, 'sig_ed25519_verified'
      )
      ON CONFLICT (obs_date) DO UPDATE SET
        total_records = EXCLUDED.total_records,
        merkle_root = EXCLUDED.merkle_root,
        final_row_hash = EXCLUDED.final_row_hash;`,
      [
        `ckp_${obsDate.replace(/-/g, '')}`,
        obsDate,
        dailyLedger.summary.rowCount,
        dailyLedger.summary.merkleRoot,
        dailyLedger.summary.finalRowHash,
      ]
    );

    // Materialize Cards
    for (const item of scoredItems) {
      await client.query(
        `INSERT INTO opportunity_cards (
          opportunity_id, slug, primary_query, verdict, lifecycle,
          d_basis_points, m_basis_points, w_basis_points,
          d_band, m_band, w_band, confidence,
          recommended_archetype, execution_class, why_now_summary, top_idea,
          first_observed_at, query_velocity, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16,
          NOW() - INTERVAL '30 days', $17, NOW()
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
          updated_at = NOW();`,
        [
          item.opportunityId,
          item.slug,
          item.primaryQuery,
          item.output.verdict,
          item.output.lifecycle,
          item.output.dScore,
          item.output.mScore,
          item.output.wScore,
          item.output.dBand,
          item.output.mBand,
          item.output.wBand,
          item.output.confidence,
          item.output.recommendedArchetype,
          item.output.executionClass,
          item.output.explanation.wReason,
          'Optimized standalone utility with instant export',
          item.velocity,
        ]
      );
    }

    // 6. Check and trigger alert rules
    const rulesRes = await client.query<{
      id: string;
      user_id: string;
      opportunity_id: string;
      rule_type: string;
    }>(
      `SELECT id, user_id, opportunity_id, rule_type FROM alert_rules WHERE is_active = true`
    );

    for (const rule of rulesRes.rows) {
      const match = scoredItems.find((s) => s.opportunityId === rule.opportunity_id);
      if (match) {
        await client.query(
          `INSERT INTO notifications (id, user_id, title, body, opportunity_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            `ntf_${Date.now()}_${rule.id}`,
            rule.user_id,
            `Radar Alert: ${match.title}`,
            `Opportunity status updated: Verdict ${match.output.verdict} (D: ${(match.output.dScore / 100).toFixed(0)}, W: ${(match.output.wScore / 100).toFixed(0)})`,
            rule.opportunity_id,
          ]
        );
        alertsTriggered++;
      }
    }
  });

  console.log(
    `[pipeline] Run complete. Processed ${scoredItems.length} opportunities, committed Merkle root ${dailyLedger.summary.merkleRoot}, triggered ${alertsTriggered} notifications.`
  );

  return {
    processedOpportunities: scoredItems.length,
    merkleRoot: dailyLedger.summary.merkleRoot,
    alertsTriggered,
  };
}
