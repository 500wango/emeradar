import { query } from '@emeradar/db';
import {
  AutocompleteCollector,
  BudgetGuard,
  CostLedgerService,
  RunContext,
  SerpCollector,
} from '@emeradar/collectors';
import { assessTaskVerification } from '../task-verification';

/**
 * In-run budget guard that accumulates every approved spend, so the cap is
 * enforced across the whole loop rather than per call.
 */
function createSpendBudget(maxDailyBudgetUsd: number): BudgetGuard {
  let spent = 0;
  return {
    maxDailyBudgetUsd,
    get currentSpentUsd() {
      return spent;
    },
    canSpend(costUsd: number): boolean {
      if (spent + costUsd > maxDailyBudgetUsd) return false;
      spent += costUsd;
      return true;
    },
  };
}

/** 测试注入点：真实采集器在构造函数里读环境变量，夹具用假的替身。 */
export interface ValidationDeps {
  ac?: Pick<AutocompleteCollector, 'collect'>;
  serp?: Pick<SerpCollector, 'collect'>;
  maxBudgetUsd?: number;
}

export async function validateDiscoveryIntents(
  limit = 5,
  obsDate = new Date().toISOString().slice(0, 10),
  deps: ValidationDeps = {}
): Promise<number> {
  const rows = await query<{ id: string; query_hypothesis: string; source_title: string }>(
    `SELECT i.id, i.query_hypothesis, d.title AS source_title
     FROM discovery_intents i
     JOIN discovery_items d ON d.id = i.discovery_item_id
     WHERE i.status = 'HYPOTHESIS'
       AND NOT EXISTS (SELECT 1 FROM discovery_validations v WHERE v.discovery_intent_id = i.id)
     ORDER BY i.created_at ASC LIMIT $1`, [limit]);
  const ac = deps.ac ?? new AutocompleteCollector();
  const serp = deps.serp ?? new SerpCollector();
  const ctx: RunContext = {
    runId: `run_discovery_validate_${Date.now()}`,
    obsDate,
    clock: () => new Date(),
    // The guard must actually accumulate inside canSpend: the previous version
    // compared a constant `0 + cost` against the cap, so the discovery budget
    // never bounded anything.
    budget: createSpendBudget(deps.maxBudgetUsd ?? Number(process.env.DISCOVERY_VALIDATION_BUDGET_USD || 0)),
  };
  let validated = 0;
  for (const row of rows.rows) {
    const queryId = `qry_discovery_${row.id}`;
    const acOutcome = await ac.collect(ctx, { queryId, queryText: row.query_hypothesis });
    if (acOutcome.status !== 'SKIPPED' && acOutcome.cost) {
      await CostLedgerService.recordCost(acOutcome.cost);
    }
    const acStatus = acOutcome.status === 'OK' ? (acOutcome.snapshots[0]?.data.suggestions?.length ? 'OBSERVED' : 'EMPTY') : acOutcome.status === 'FAILED' ? 'FAILED' : 'UNKNOWN';
    const suggestions = acOutcome.status === 'OK' ? acOutcome.snapshots[0]?.data.suggestions ?? [] : [];
    const serpOutcome = await serp.collect(ctx, { queryId, queryText: row.query_hypothesis });
    if (serpOutcome.status !== 'SKIPPED' && serpOutcome.cost) {
      await CostLedgerService.recordCost(serpOutcome.cost);
    }
    const serpData = serpOutcome.status === 'OK' ? serpOutcome.snapshots[0]?.data : undefined;
    const serpStatus = serpOutcome.status === 'OK' ? (serpData?.items?.length ? 'OBSERVED' : 'EMPTY') : serpOutcome.status === 'FAILED' ? 'FAILED' : 'UNKNOWN';
    const serpItems = serpData?.items ?? [];

    // 审计 02：「是工具页」≠「能解决这个搜索任务」。供给计数只吃**确证满足**
    // 目标查询的专属工具页；存在专属工具页但无一满足、且无法确证时，
    // 缺口状态是 UNKNOWN——不可靠证据不允许自动变成缺口。
    const specialistCandidates = serpItems.filter((item: any) => item.resultType === 'SPECIALIST');
    const satisfyingSpecialistCount = specialistCandidates.filter(
      (item: any) => item.queryRelevance === 'SATISFIES'
    ).length;
    const unresolvedSpecialistCount = specialistCandidates.filter(
      (item: any) => item.queryRelevance !== 'SATISFIES'
    ).length;
    const specialistResultCount = satisfyingSpecialistCount;
    const authoritativeResultCount = serpItems.filter((item: any) => ['OFFICIAL', 'DOC'].includes(item.resultType)).length;

    let supplyGapStatus: 'UNKNOWN' | 'NO_DEDICATED_TOOL_OBSERVED' | 'MIXED_SUPPLY' | 'DEDICATED_SUPPLY';
    let supplyGapNote: string;
    if (serpStatus !== 'OBSERVED') {
      supplyGapStatus = 'UNKNOWN';
      supplyGapNote = 'SERP evidence is unavailable or empty; supply gap remains unknown.';
    } else if (satisfyingSpecialistCount === 0 && unresolvedSpecialistCount > 0) {
      supplyGapStatus = 'UNKNOWN';
      supplyGapNote = `${unresolvedSpecialistCount} dedicated tool page(s) observed, but none verifiably satisfies this query; task satisfaction remains unjudged. Review manually before treating this as a gap.`;
    } else if (specialistResultCount === 0) {
      supplyGapStatus = 'NO_DEDICATED_TOOL_OBSERVED';
      supplyGapNote = 'No dedicated specialist result was observed in the captured SERP; review task satisfaction manually before treating this as a gap.';
    } else if (specialistResultCount < 3) {
      supplyGapStatus = 'MIXED_SUPPLY';
      supplyGapNote = `${specialistResultCount} dedicated specialist result(s) that satisfy the query; this is supply evidence, not a success prediction.`;
    } else {
      supplyGapStatus = 'DEDICATED_SUPPLY';
      supplyGapNote = `${specialistResultCount} dedicated specialist result(s) that satisfy the query; this is supply evidence, not a success prediction.`;
    }

    // 审计 01：检索证据存在 ≠ 用户任务存在。任务验证结论与依据随验证落库，
    // 决定 intent 能否晋级（REFUTED → REJECTED）与能否进实验卡（仅 VERIFIED）。
    const task = assessTaskVerification({
      sourceTitle: row.source_title,
      queryHypothesis: row.query_hypothesis,
      serpItems,
      autocompleteSuggestions: suggestions,
    });

    await query(
      `INSERT INTO discovery_validations (id, discovery_intent_id, observed_date, observed_at, autocomplete_status, autocomplete_suggestions, serp_status, serp_result_count, serp_weak_result_ratio, specialist_result_count, authoritative_result_count, supply_gap_status, supply_gap_note, task_status, task_evidence, evidence)
       VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (discovery_intent_id, observed_date) DO UPDATE SET
         observed_at = NOW(), autocomplete_status = EXCLUDED.autocomplete_status,
         autocomplete_suggestions = EXCLUDED.autocomplete_suggestions, serp_status = EXCLUDED.serp_status,
         serp_result_count = EXCLUDED.serp_result_count, serp_weak_result_ratio = EXCLUDED.serp_weak_result_ratio,
         specialist_result_count = EXCLUDED.specialist_result_count,
         authoritative_result_count = EXCLUDED.authoritative_result_count,
         supply_gap_status = EXCLUDED.supply_gap_status,
         supply_gap_note = EXCLUDED.supply_gap_note,
         task_status = EXCLUDED.task_status,
         task_evidence = EXCLUDED.task_evidence,
         evidence = EXCLUDED.evidence`,
      [`dval_${row.id}_${obsDate}`, row.id, obsDate, acStatus, suggestions, serpStatus, serpData?.items?.length ?? null, serpData?.weakResultRatio ?? null, specialistResultCount || null, authoritativeResultCount || null, supplyGapStatus, supplyGapNote, task.taskStatus, JSON.stringify(task.evidence), JSON.stringify({ autocomplete: 'live', serp: 'live', query: row.query_hypothesis, supplyGapMethod: 'query-satisfied-specialist-count', taskVersion: task.version })],
    );
    if (task.taskStatus === 'TASK_REFUTED') {
      // 新闻/导航型条目：检索证据再充分也不是用户任务，直接拒绝。
      await query(`UPDATE discovery_intents SET status = 'REJECTED' WHERE id = $1`, [row.id]);
    } else if (acStatus === 'OBSERVED' || serpStatus === 'OBSERVED') {
      await query(`UPDATE discovery_intents SET status = 'OBSERVED' WHERE id = $1`, [row.id]);
    }
    validated++;
  }
  return validated;
}
