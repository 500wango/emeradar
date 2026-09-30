import { query } from '@emeradar/db';
import { AutocompleteCollector, RunContext, SerpCollector } from '@emeradar/collectors';

export async function validateDiscoveryIntents(limit = 5, obsDate = new Date().toISOString().slice(0, 10)): Promise<number> {
  const rows = await query<{ id: string; query_hypothesis: string }>(
    `SELECT i.id, i.query_hypothesis
     FROM discovery_intents i
     WHERE i.status = 'HYPOTHESIS'
       AND NOT EXISTS (SELECT 1 FROM discovery_validations v WHERE v.discovery_intent_id = i.id)
     ORDER BY i.created_at ASC LIMIT $1`, [limit]);
  const ac = new AutocompleteCollector();
  const serp = new SerpCollector();
  const ctx: RunContext = {
    runId: `run_discovery_validate_${Date.now()}`,
    obsDate,
    clock: () => new Date(),
    budget: { maxDailyBudgetUsd: Number(process.env.DISCOVERY_VALIDATION_BUDGET_USD || 0), currentSpentUsd: 0, canSpend(cost) { return this.currentSpentUsd + cost <= this.maxDailyBudgetUsd; } },
  };
  let validated = 0;
  for (const row of rows.rows) {
    const queryId = `qry_discovery_${row.id}`;
    const acOutcome = await ac.collect(ctx, { queryId, queryText: row.query_hypothesis });
    const acStatus = acOutcome.status === 'OK' ? (acOutcome.snapshots[0]?.data.suggestions?.length ? 'OBSERVED' : 'EMPTY') : acOutcome.status === 'FAILED' ? 'FAILED' : 'UNKNOWN';
    const suggestions = acOutcome.status === 'OK' ? acOutcome.snapshots[0]?.data.suggestions ?? [] : [];
    const serpOutcome = await serp.collect(ctx, { queryId, queryText: row.query_hypothesis });
    const serpData = serpOutcome.status === 'OK' ? serpOutcome.snapshots[0]?.data : undefined;
    const serpStatus = serpOutcome.status === 'OK' ? (serpData?.items?.length ? 'OBSERVED' : 'EMPTY') : serpOutcome.status === 'FAILED' ? 'FAILED' : 'UNKNOWN';
    const serpItems = serpData?.items ?? [];
    const specialistResultCount = serpItems.filter((item: any) => item.resultType === 'SPECIALIST').length;
    const authoritativeResultCount = serpItems.filter((item: any) => ['OFFICIAL', 'DOC'].includes(item.resultType)).length;
    const supplyGapStatus = serpStatus !== 'OBSERVED'
      ? 'UNKNOWN'
      : specialistResultCount === 0
        ? 'NO_DEDICATED_TOOL_OBSERVED'
        : specialistResultCount < 3
          ? 'MIXED_SUPPLY'
          : 'DEDICATED_SUPPLY';
    const supplyGapNote = serpStatus !== 'OBSERVED'
      ? 'SERP evidence is unavailable or empty; supply gap remains unknown.'
      : specialistResultCount === 0
        ? 'No dedicated specialist result was observed in the captured SERP; review task satisfaction manually before treating this as a gap.'
        : `${specialistResultCount} dedicated specialist result(s) observed; this is supply evidence, not a success prediction.`;
    await query(
      `INSERT INTO discovery_validations (id, discovery_intent_id, observed_date, observed_at, autocomplete_status, autocomplete_suggestions, serp_status, serp_result_count, serp_weak_result_ratio, specialist_result_count, authoritative_result_count, supply_gap_status, supply_gap_note, evidence)
       VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (discovery_intent_id, observed_date) DO UPDATE SET
         observed_at = NOW(), autocomplete_status = EXCLUDED.autocomplete_status,
         autocomplete_suggestions = EXCLUDED.autocomplete_suggestions, serp_status = EXCLUDED.serp_status,
         serp_result_count = EXCLUDED.serp_result_count, serp_weak_result_ratio = EXCLUDED.serp_weak_result_ratio,
         specialist_result_count = EXCLUDED.specialist_result_count,
         authoritative_result_count = EXCLUDED.authoritative_result_count,
         supply_gap_status = EXCLUDED.supply_gap_status,
         supply_gap_note = EXCLUDED.supply_gap_note,
         evidence = EXCLUDED.evidence`,
      [`dval_${row.id}_${obsDate}`, row.id, obsDate, acStatus, suggestions, serpStatus, serpData?.items?.length ?? null, serpData?.weakResultRatio ?? null, specialistResultCount || null, authoritativeResultCount || null, supplyGapStatus, supplyGapNote, JSON.stringify({ autocomplete: 'live', serp: 'live', query: row.query_hypothesis, supplyGapMethod: 'result-type-count' })],
    );
    if (acStatus === 'OBSERVED' || serpStatus === 'OBSERVED') {
      await query(`UPDATE discovery_intents SET status = 'OBSERVED' WHERE id = $1`, [row.id]);
    }
    validated++;
  }
  return validated;
}
