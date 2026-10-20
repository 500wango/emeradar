import { query } from '@emeradar/db';
import { AppError } from '@emeradar/core';
import { AuditService } from '../audit.service';
import { TrackRecordService } from '../track-record.service';
import { rejectionSummary } from '../rejection.service';
import { seedKeywordCandidates } from '../pipeline/seed-keyword-candidates';
import { enrichDemand } from '../demand-enrichment.service';
import { shadowPoolStats } from '../shadow-pool.service';
import {
  discoverSources,
  generateDiscoveryIntents,
  validateDiscoveryIntents,
  runDailyPipeline,
} from '../pipeline';
import type { AdminPipelineOverview } from './types';

// Maximum time an admin HTTP trigger will wait synchronously for a heavy
// pipeline task. The task keeps running in-process under its advisory lock
// even after we return to the caller, and any re-trigger is rejected by that
// lock until the run finishes — so this only bounds request latency.
const PIPELINE_MAX_WAIT_MS = 120_000;

function withPipelineTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} exceeded the ${Math.round(PIPELINE_MAX_WAIT_MS / 1000)}s synchronous wait limit ` +
            `and is still running in the background under a concurrency lock. ` +
            `Do not re-trigger until it completes.`
        )
      );
    }, PIPELINE_MAX_WAIT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** 当日观测日（YYYY-MM-DD），与管线其它入口同口径。 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class AdminPipelineService {
  /**
   * Retrieves overall pipeline health, API cost watermark, and recent collector execution runs
   */
  static async getPipelineOverview(): Promise<AdminPipelineOverview> {
    // 1. Opportunity counts by status
    const statsRes = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM opportunities GROUP BY status`
    );
    let tracked = 0;
    let candidate = 0;
    let archived = 0;
    for (const r of statsRes.rows) {
      const c = parseInt(r.count, 10) || 0;
      if (r.status === 'TRACKED') tracked = c;
      else if (r.status === 'CANDIDATE') candidate = c;
      else if (r.status === 'ARCHIVED') archived = c;
    }

    // 1b. Discovery quality: candidate intake + Inbox feedback (7d)
    const discoveryRes = await query<{
      candidates: number;
      new_candidates_7d: number;
    }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'CANDIDATE')::int AS candidates,
              COUNT(*) FILTER (WHERE status = 'CANDIDATE'
                                AND first_observed_date >= CURRENT_DATE - 6)::int AS new_candidates_7d
         FROM opportunities`
    );
    const feedbackRes = await query<{ reason: string; count: number }>(
      `SELECT reason, COUNT(*)::int AS count
         FROM opportunity_feedback
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY reason`
    );
    const fb = Object.fromEntries(feedbackRes.rows.map((r) => [r.reason, r.count]));
    const helpfulFeedback7d = (fb.INTERESTED ?? 0) + (fb.SAVED ?? 0);
    const negativeFeedback7d =
      (fb.NOT_OPPORTUNITY ?? 0) + (fb.ALREADY_BUILT ?? 0) + (fb.CANNOT_BUILD ?? 0);
    const feedback7d = helpfulFeedback7d + negativeFeedback7d;
    const latencyRes = await query<{ median_hours: number | null }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (f.created_at - o.discovered_at)) / 3600
              )::float8 AS median_hours
         FROM opportunity_feedback f
         JOIN opportunities o ON o.id = f.opportunity_id
        WHERE f.created_at > NOW() - INTERVAL '30 days'
          AND o.discovered_at IS NOT NULL`
    );
    const coverageRes = await query<{
      active_sources: number;
      sources_with_runs_24h: number;
      candidate_markets: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM sources WHERE is_active = true) AS active_sources,
         (SELECT COUNT(DISTINCT source_id)::int FROM collector_runs
           WHERE started_at > NOW() - INTERVAL '24 hours') AS sources_with_runs_24h,
         (SELECT COUNT(DISTINCT market_country)::int FROM opportunities
           WHERE status = 'CANDIDATE') AS candidate_markets`
    );

    // 2. Today's API costs from cost_ledger
    const costRes = await query<{ total_cost: string }>(
      `SELECT COALESCE(SUM(cost_usd), 0)::text AS total_cost
       FROM cost_ledger
       WHERE recorded_at >= CURRENT_DATE`
    );
    const costTodayUsd = parseFloat(costRes.rows[0]?.total_cost || '0');

    // 3. 最新账本检查点 —— 连同**重算结果**一起返回
    //
    // 这块面板原先只读 merkle_root，再配一个写死的绿勾"存证完整"。那是断言，不是
    // 验证：任何一行被改写、任何一天的行残缺，绿勾照样亮。这里改成真的按库里存的
    // 行重算一遍（复用公开验证端点 `/api/v1/public/verify-ledger` 走的同一段逻辑），
    // 把结论交给页面显示。
    const ckpRes = await query<{
      obs_date: string;
      merkle_root: string;
      total_records: number;
      verified_at: string;
    }>(
      `SELECT obs_date::text, merkle_root, total_records, verified_at::text
       FROM ledger_checkpoints
       ORDER BY obs_date DESC
       LIMIT 1`
    );

    let recomputed: {
      verified: boolean;
      calculatedMerkleRoot: string;
      rowCount: number;
    } | null = null;
    if (ckpRes.rows[0]) {
      try {
        const v = await TrackRecordService.verifyCheckpoint(ckpRes.rows[0].obs_date);
        recomputed = {
          verified: v.verified,
          calculatedMerkleRoot: v.calculatedMerkleRoot,
          rowCount: v.rowCount,
        };
      } catch {
        // 保留 null：重算没跑成 ≠ 重算发现不一致。页面据此显示"无法重算"。
        recomputed = null;
      }
    }

    const latestCkp = ckpRes.rows[0]
      ? {
          obsDate: ckpRes.rows[0].obs_date,
          merkleRoot: ckpRes.rows[0].merkle_root,
          totalRecords: ckpRes.rows[0].total_records,
          recordedAt: ckpRes.rows[0].verified_at,
          recomputed,
        }
      : null;

    // 4. Recent collector runs
    const runsRes = await query<{
      id: string;
      source_id: string;
      source_name: string;
      status: string;
      items_collected: number;
      started_at: string;
      finished_at: string | null;
      error_message: string | null;
    }>(
      `SELECT cr.id, cr.source_id, COALESCE(s.name, cr.source_id) AS source_name,
              cr.status, cr.items_collected, cr.started_at::text, cr.finished_at::text, cr.error_message
       FROM collector_runs cr
       LEFT JOIN sources s ON s.id = cr.source_id
       ORDER BY cr.started_at DESC
       LIMIT 12`
    );

    // 4b. Stale-data degradation events (04 §2 / ADR-021)
    const staleRes = await query<{
      id: string;
      obs_date: string;
      opportunity_id: string;
      slug: string;
      title: string;
      source: 'AUTOCOMPLETE' | 'SERP' | 'COMMERCIAL';
      domain: string;
      reference_id: string | null;
      observed_at: string | null;
    }>(
      `SELECT e.id::text, e.obs_date::text, e.opportunity_id, o.slug, o.title,
              e.source, e.domain, e.reference_id, e.observed_at::text
         FROM stale_data_events e
         JOIN opportunities o ON o.id = e.opportunity_id
        ORDER BY e.obs_date DESC, e.created_at DESC
        LIMIT 20`
    ).catch(() => ({ rows: [] as any[] }));

    // 4a. 候选池的需求档位分布：回答“我们捞到的词到底有多大”。
    const bandRes = await query<{ band: string | null; count: number }>(
      `SELECT volume_band AS band, COUNT(*)::int AS count
         FROM opportunities
        WHERE status = 'CANDIDATE'
        GROUP BY 1
        ORDER BY 1 NULLS LAST`
    );
    const bandedRes = await query<{ banded: number; total: number }>(
      `SELECT COUNT(*) FILTER (WHERE volume_band IS NOT NULL)::int AS banded,
              COUNT(*)::int AS total
         FROM opportunities WHERE status = 'CANDIDATE'`
    );
    const topCandidatesRes = await query<{
      id: string;
      title: string;
      volume_band: string | null;
      entry_search_volume: number | null;
      entry_keyword_difficulty: number | null;
      demand_trend: string | null;
      vendor_intent: string | null;
      discovery_source: string | null;
    }>(
      `SELECT id, title, volume_band, entry_search_volume, entry_keyword_difficulty,
              demand_trend, vendor_intent, discovery_source
         FROM opportunities
        WHERE status = 'CANDIDATE'
        ORDER BY entry_search_volume DESC NULLS LAST, created_at DESC
        LIMIT 10`
    );
    const bandStats = bandedRes.rows[0] ?? { banded: 0, total: 0 };

    // 4b0. Phase 0/2 observability: rejection reasons + shadow-pool FNR
    const rejectionsRes = await rejectionSummary(new Date().toISOString().slice(0, 10)).catch(() => []);
    const shadowStats = await shadowPoolStats().catch(() => []);
    const shadowTotals = shadowStats.reduce(
      (acc, row) => ({
        samples: acc.samples + row.samples,
        captured: acc.captured + row.captured,
        becameOpportunity: acc.becameOpportunity + row.becameOpportunity,
      }),
      { samples: 0, captured: 0, becameOpportunity: 0 }
    );
    const shadowPool = {
      ...shadowTotals,
      // 总体漏判率只在有回访样本时给出；否则 null，界面显示“未知”，不是 0%。
      weightedFnr:
        shadowTotals.captured > 0
          ? Math.round((shadowTotals.becameOpportunity / shadowTotals.captured) * 10000) / 10000
          : null,
      strata: shadowStats,
    };

    // 4b2. Commercial pricing capture health (7d)
    const commercialRes = await query<{
      total_7d: number;
      ok_7d: number;
      failed_7d: number;
      blocked_404: number;
      robots_disallowed: number;
      budget_skipped: number;
      priced: number;
      infra_present: number;
    }>(
      `SELECT COUNT(*)::int AS total_7d,
              COUNT(*) FILTER (WHERE cs.fetch_status = 'OK')::int AS ok_7d,
              COUNT(*) FILTER (WHERE cs.fetch_status = 'FAILED')::int AS failed_7d,
              COUNT(*) FILTER (WHERE cs.fetch_status = 'BLOCKED_404')::int AS blocked_404,
              COUNT(*) FILTER (WHERE cs.fetch_status = 'ROBOTS_DISALLOWED')::int AS robots_disallowed,
              COUNT(*) FILTER (WHERE cs.fetch_status = 'BUDGET_SKIPPED')::int AS budget_skipped,
              COUNT(*) FILTER (WHERE cs.commercial_stage = 'PRICED')::int AS priced,
              COUNT(*) FILTER (WHERE cs.commercial_stage = 'INFRA_PRESENT')::int AS infra_present
         FROM commercial_snapshots cs
        WHERE cs.obs_date > CURRENT_DATE - 7`
    );
    const commercialFailuresRes = await query<{
      domain: string;
      fetch_status: string;
      obs_date: string;
      fetch_tier: string;
    }>(
      `SELECT ct.domain, cs.fetch_status, cs.obs_date::text, cs.fetch_tier
         FROM commercial_snapshots cs
         JOIN commercial_targets ct ON ct.id = cs.commercial_target_id
        WHERE cs.obs_date > CURRENT_DATE - 7
          AND cs.fetch_status <> 'OK'
        ORDER BY cs.obs_date DESC, ct.domain
        LIMIT 12`
    );

    // 4c. Tavily source status (discovery only; not W-axis)
    const tavilySourceRes = await query<{
      is_active: boolean;
      items_24h: number;
      items_7d: number;
      last_item_at: string | null;
    }>(
      `SELECT s.is_active,
              (SELECT COUNT(*)::int FROM discovery_items d
                WHERE d.source_id = s.id AND d.first_collected_at > NOW() - INTERVAL '24 hours') AS items_24h,
              (SELECT COUNT(*)::int FROM discovery_items d
                WHERE d.source_id = s.id AND d.first_collected_at > NOW() - INTERVAL '7 days') AS items_7d,
              (SELECT MAX(d.first_collected_at)::text FROM discovery_items d
                WHERE d.source_id = s.id) AS last_item_at
         FROM sources s WHERE s.id = 'src_tavily'`
    );
    const tavilyRunsRes = await query<{
      id: string;
      status: string;
      items_collected: number;
      started_at: string;
      finished_at: string | null;
      error_message: string | null;
    }>(
      `SELECT id, status, items_collected, started_at::text, finished_at::text, error_message
         FROM collector_runs
        WHERE source_id = 'src_tavily'
        ORDER BY started_at DESC
        LIMIT 5`
    );
    const tavilySource = tavilySourceRes.rows[0];
    const tavilyLast = tavilyRunsRes.rows[0];

    // 5. Latest discovery signals
    const signalsRes = await query<{
      id: string;
      title: string;
      provider: string;
      source_url: string;
      collected_at: string;
    }>(
      `SELECT id, title, provider, source_url, first_collected_at::text as collected_at
       FROM discovery_items
       ORDER BY first_collected_at DESC
       LIMIT 15`
    );

    // 6. Recent pipeline runs (observability)
    const pipelineRunsRes = await query<{
      id: string;
      obs_date: string;
      status: string;
      started_at: string;
      completed_at: string | null;
      duration_ms: number | null;
      processed_opportunities: number;
      merkle_root: string | null;
      alerts_triggered: number;
      error_message: string | null;
    }>(
      `SELECT id, obs_date::text, status, started_at::text, completed_at::text,
              duration_ms, processed_opportunities, merkle_root, alerts_triggered, error_message
       FROM pipeline_runs
       ORDER BY started_at DESC
       LIMIT 10`
    ).catch(() => ({ rows: [] }));

    return {
      opportunityStats: {
        tracked,
        candidate,
        archived,
        total: tracked + candidate + archived,
      },
      discoveryStats: {
        candidates: discoveryRes.rows[0]?.candidates ?? 0,
        newCandidates7d: discoveryRes.rows[0]?.new_candidates_7d ?? 0,
        feedback7d,
        helpfulFeedback7d,
        negativeFeedback7d,
        negativeRate7d: feedback7d > 0 ? negativeFeedback7d / feedback7d : 0,
        activeSources: coverageRes.rows[0]?.active_sources ?? 0,
        sourcesWithRuns24h: coverageRes.rows[0]?.sources_with_runs_24h ?? 0,
        candidateMarkets: coverageRes.rows[0]?.candidate_markets ?? 0,
        medianFeedbackLatencyHours:
          latencyRes.rows[0]?.median_hours !== null && latencyRes.rows[0]?.median_hours !== undefined
            ? Math.round(latencyRes.rows[0].median_hours * 10) / 10
            : null,
      },
      costTodayUsd,
      dailyBudgetLimitUsd: 20.0,
      latestCheckpoint: latestCkp,
      recentCollectorRuns: runsRes.rows.map((r) => ({
        id: r.id,
        sourceId: r.source_id,
        sourceName: r.source_name,
        status: r.status,
        itemsCollected: r.items_collected,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        errorMessage: r.error_message,
      })),
      demand: {
        bands: bandRes.rows.map((row) => ({ band: row.band, count: row.count })),
        bandedShare: bandStats.total > 0 ? bandStats.banded / bandStats.total : 0,
        topCandidates: topCandidatesRes.rows.map((row) => ({
          id: row.id,
          title: row.title,
          volumeBand: row.volume_band,
          searchVolume: row.entry_search_volume,
          keywordDifficulty: row.entry_keyword_difficulty,
          demandTrend: row.demand_trend,
          vendorIntent: row.vendor_intent,
          discoverySource: row.discovery_source,
        })),
      },
      shadowPool,
      rejections: rejectionsRes.map((row) => ({
        reasonCode: row.reasonCode,
        axis: row.axis,
        count: row.count,
      })),
      commercial: {
        total7d: commercialRes.rows[0]?.total_7d ?? 0,
        ok7d: commercialRes.rows[0]?.ok_7d ?? 0,
        failed7d: commercialRes.rows[0]?.failed_7d ?? 0,
        blocked404: commercialRes.rows[0]?.blocked_404 ?? 0,
        robotsDisallowed: commercialRes.rows[0]?.robots_disallowed ?? 0,
        budgetSkipped: commercialRes.rows[0]?.budget_skipped ?? 0,
        priced: commercialRes.rows[0]?.priced ?? 0,
        infraPresent: commercialRes.rows[0]?.infra_present ?? 0,
        recentFailures: commercialFailuresRes.rows.map((r) => ({
          domain: r.domain,
          fetchStatus: r.fetch_status,
          obsDate: r.obs_date,
          fetchTier: r.fetch_tier,
        })),
      },
      tavily: {
        configured: Boolean(tavilySource),
        active: Boolean(tavilySource?.is_active),
        items24h: tavilySource?.items_24h ?? 0,
        items7d: tavilySource?.items_7d ?? 0,
        lastItemAt: tavilySource?.last_item_at ?? null,
        lastRunAt: tavilyLast?.started_at ?? null,
        lastStatus: tavilyLast?.status ?? null,
        lastError: tavilyLast?.error_message ?? null,
        runs: tavilyRunsRes.rows.map((r) => ({
          id: r.id,
          status: r.status,
          itemsCollected: r.items_collected,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          errorMessage: r.error_message,
        })),
      },
      recentStaleEvents: staleRes.rows.map((r: any) => ({
        id: r.id,
        obsDate: r.obs_date,
        opportunityId: r.opportunity_id,
        opportunitySlug: r.slug,
        opportunityTitle: r.title,
        source: r.source,
        domain: r.domain,
        referenceId: r.reference_id,
        observedAt: r.observed_at,
      })),
      latestDiscoverySignals: signalsRes.rows.map((r) => ({
        id: r.id,
        title: r.title,
        provider: r.provider,
        sourceUrl: r.source_url,
        collectedAt: r.collected_at,
      })),
      recentPipelineRuns: pipelineRunsRes.rows.map((r) => ({
        id: r.id,
        obsDate: r.obs_date,
        status: r.status,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        durationMs: r.duration_ms,
        processedOpportunities: r.processed_opportunities,
        merkleRoot: r.merkle_root,
        alertsTriggered: r.alerts_triggered,
        errorMessage: r.error_message,
      })),
    };
  }
  /**
   * Triggers an automated worker task asynchronously
   * Triggers an automated worker task directly in-process
   */
  static async triggerTask(
    task:
      | 'discover'
      | 'seed-keywords'
      | 'enrich-demand'
      | 'generate-intents'
      | 'validate-intents'
      | 'run-daily',
    actorId: string | null = null
  ): Promise<{
    task: string;
    output: string;
    exitCode: number;
  }> {
    await AuditService.log({
      actorId,
      actorType: actorId ? 'ADMIN' : 'SYSTEM',
      action: 'pipeline.trigger',
      targetType: 'task',
      targetId: task,
    });
    const logs: string[] = [];
    const log = (msg: string) => {
      console.log(msg);
      logs.push(msg);
    };

    try {
      if (task === 'seed-keywords') {
        log('[pipeline] Seeding keyword candidates from tool-intent seeds...');
        const result = await withPipelineTimeout(seedKeywordCandidates(today()), 'Keyword seed');
        log('[pipeline] Seed result:');
        log(` - Seeds: ${result.seeds.join(', ') || '(none)'}`);
        log(` - Suggestions fetched: ${result.fetched}`);
        log(` - New candidates: ${result.created}`);
        log(` - Failed seeds: ${result.failures}`);
        if (result.skipped) log(` - Skipped: ${result.reason ?? 'unknown'}`);
        return { task, output: logs.join('\n'), exitCode: 0 };
      }

      if (task === 'enrich-demand') {
        log('[pipeline] Enriching demand (volume / intent / 12-month trend)...');
        const result = await withPipelineTimeout(enrichDemand(), 'Demand enrichment');
        log('[pipeline] Demand result:');
        log(` - Scanned: ${result.scanned}`);
        log(` - Updated: ${result.updated}`);
        log(` - Failed: ${result.failed}`);
        if (result.skipped) log(` - Skipped: ${result.reason ?? 'unknown'}`);
        return { task, output: logs.join('\n'), exitCode: 0 };
      }

      if (task === 'discover') {
        log('[pipeline] Starting signal discovery across active sources and feeds...');
        const res = await withPipelineTimeout(discoverSources(), 'Signal discovery');
        log('[pipeline] Discovery completed:');
        log(` - Sources scanned: ${res.sources}`);
        log(` - Raw items collected: ${res.collected}`);
        log(` - New items recorded: ${res.inserted}`);
        log(` - Failed sources: ${res.failed}`);

        if (res.recentItems.length > 0) {
          log('\n[pipeline] Recently captured raw signals:');
          for (const item of res.recentItems.slice(0, 10)) {
            log(` • [${item.provider}] ${item.title}`);
          }
        }

        // 新闻标题不再自动孵化成候选（2026-10-18）：它们描述的是新闻，不是搜索需求，
        // 孵化出来的主 query 也没有 SERP 层级，永远发布不了。候选改由每日
        // `seed-keywords` 从工具意图种子生成；这里采集到的条目只作 Why Now 的注意力证据。

        return {
          task,
          output: logs.join('\n'),
          exitCode: 0,
        };
      }

      if (task === 'generate-intents') {
        log('[pipeline] Generating unverified query intent hypotheses from collected items...');
        const created = await generateDiscoveryIntents(50);
        log(`[pipeline] Intent generation completed: ${created} new intent hypotheses generated.`);


        return {
          task,
          output: logs.join('\n'),
          exitCode: 0,
        };
      }

      if (task === 'validate-intents') {
        log('[pipeline] Validating discovery intent hypotheses against search signals...');
        const validated = await validateDiscoveryIntents(5);
        log(`[pipeline] Intent validation completed: ${validated} discovery intents validated.`);
        return {
          task,
          output: logs.join('\n'),
          exitCode: 0,
        };
      }

      if (task === 'run-daily') {
        const obsDate = new Date().toISOString().slice(0, 10);
        log(`[pipeline] Running daily discovery & observation pipeline for ${obsDate}...`);
        const res = await withPipelineTimeout(runDailyPipeline(obsDate, 'admin'), 'Daily pipeline');
        log(`[pipeline] Daily pipeline run complete for ${obsDate}:`);
        log(` - Processed opportunities: ${res.processedOpportunities}`);
        log(` - Ledger Merkle Root: ${res.merkleRoot || 'N/A'}`);
        log(` - Alerts triggered: ${res.alertsTriggered}`);
        return {
          task,
          output: logs.join('\n'),
          exitCode: 0,
        };
      }

      throw AppError.badRequest(`Unknown task: ${task}`);
    } catch (err: any) {
      log(`[pipeline] Execution error: ${err.message || String(err)}`);
      if (err.stack) {
        log(err.stack);
      }
      return {
        task,
        output: logs.join('\n'),
        exitCode: 1,
      };
    }
  }
}
