import { query, transaction, getClient } from '@emeradar/db';
import {
  generateDailyLedger,
  GENESIS_PREV_HASH,
  calculateFeaturesHash,
  isV2Row,
  isV3Row,
  DailyLedgerRecord,
  PredictionSpec,
  VerdictRowDataV3,
} from '@emeradar/ledger';
import {
  AutocompleteCollector,
  CostLedgerService,
  CrawlCollector,
  RunContext,
  SerpCollector,
} from '@emeradar/collectors';
import { SCORING_CONFIG_VERSION, evaluateKillPredicate } from '@emeradar/scoring';
import { observeOpportunity, ObservedOpportunity } from './observe-opportunity';
import { ACTIVE_EVAL_CRITERIA, PredictionEpisodeService } from '../prediction-episode.service';
import { PublicPublicationService } from '../public-publication.service';
import { buildCannibalizationIndex } from '../publication-policy';
import { sendTransactionalEmail } from '../email.service';
import { evaluateAlertTrigger, isEvaluatedRuleType, type CrowdingFacts } from '../alert-triggers';
import { loadCrowding } from '../crowding.service';
import { CustomQueryRadarService } from '../custom-query-radar.service';
import { attachAutocompleteClusters } from './discover-candidates';
import {
  captureCheckpoint,
  evaluateShadowOutcome,
  pendingCheckpoints,
  sampleShadowPool,
} from '../shadow-pool.service';

const PIPELINE_LOCK_ID = 481516;

export async function runDailyPipeline(
  obsDate = new Date().toISOString().slice(0, 10),
  /**
   * 谁发起了这次运行：`'queue' | 'admin' | 'cli'`。
   *
   * 这个值此前是写死的 `'cli/cron'`，于是 `pipeline_runs` 说不了"这一次是运维在
   * 后台点的、还是排期跑的"——出问题时最想知道的恰好是这个。定时任务、管理员
   * 触发、手工执行三条路径都真实存在，记录就必须区分它们。
   */
  trigger: string = 'cli'
): Promise<{
  processedOpportunities: number;
  merkleRoot: string;
  alertsTriggered: number;
  episodesOpened: number;
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
    return { processedOpportunities: 0, merkleRoot: '', alertsTriggered: 0, episodesOpened: 0 };
  }

  const runId = `run_${obsDate.replace(/-/g, '')}_${Date.now()}`;
  const startTime = Date.now();
  await query(
    `INSERT INTO pipeline_runs (id, obs_date, status, started_at, metadata)
     VALUES ($1, $2, 'RUNNING', NOW(), $3)
     ON CONFLICT (id) DO NOTHING`,
    [runId, obsDate, JSON.stringify({ trigger })]
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

  // Phase 2：先回收到期回访，再抽样。顺序固定——先收结果，样本池才不会
  // 因为“今天新抽的样本还没到期”而看起来永远为空。
  try {
    const due = await pendingCheckpoints(obsDate);
    for (const checkpoint of due) {
      const outcome = await evaluateShadowOutcome(checkpoint.opportunityId);
      await captureCheckpoint(checkpoint.checkpointId, outcome.outcome, {
        ...outcome.evidence,
        horizonDays: checkpoint.horizonDays,
      });
    }
    if (due.length > 0) console.log(`[pipeline] shadow checkpoints captured: ${due.length}`);
  } catch (error) {
    // 暗池是观测，不是账本；失败不能拖垮当日管线。
    console.error('[pipeline] shadow checkpoint capture failed:', error);
  }

  // 每周抽一次，避免每天都扩样本把回访成本推高。
  const weekday = new Date(`${obsDate}T00:00:00Z`).getUTCDay();
  if (weekday === 1) {
    try {
      const shadow = await sampleShadowPool(obsDate);
      if (shadow.sampled > 0) {
        console.log(`[pipeline] shadow pool sampled ${shadow.sampled} (checkpoints ${shadow.checkpointsScheduled})`);
      }
    } catch (error) {
      console.error('[pipeline] shadow pool sampling failed:', error);
    }
  }

  const attachedClusterQueries = await attachAutocompleteClusters(obsDate);
  if (attachedClusterQueries > 0) {
    console.log(`[pipeline] Attached ${attachedClusterQueries} autocomplete queries to opportunity clusters.`);
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
    return { processedOpportunities: 0, merkleRoot: '', alertsTriggered: 0, episodesOpened: 0 };
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
      episodesOpened: 0,
    };
  }

  // Guard against a half-written ledger day: verdict rows for this obs_date
  // without a checkpoint mean a previous run crashed mid-write. Abort loudly
  // rather than computing a hash chain that silently skips existing rows.
  const orphanVerdicts = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM verdicts WHERE obs_date = $1`,
    [obsDate]
  );
  if (Number(orphanVerdicts.rows[0]?.count ?? '0') > 0) {
    throw new Error(
      `Refusing to write the ledger for ${obsDate}: ${orphanVerdicts.rows[0].count} verdict row(s) already exist ` +
        `without a checkpoint. Resolve the partial write before re-running.`
    );
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

  // v3：在 v2 的依据字段之外，把"这一行声明的判据"一并封存（见 row-hash.ts 的
  // PredictionSpec）。只有真的发布了预测的行才带规格；其余行显式写 null，表示
  // "这一行没有预测"，与"这一行是旧格式、不知道有没有预测"区分开。
  const predictionSpec: PredictionSpec | null = {
    criteriaVersion: ACTIVE_EVAL_CRITERIA.criteriaVersion,
    horizons: [...ACTIVE_EVAL_CRITERIA.horizons],
    target: ACTIVE_EVAL_CRITERIA.target,
  };

  const ledgerRows: DailyLedgerRecord[] = publishable.map((item) => {
    // v2：除三轴与裁决外，把去抖前的原始裁决、标志与规则轨迹一并封存。
    // 没有它，下一期的去抖拿不到 prev.rawVerdict，升档条件恒假（见 observe-opportunity）。
    const rowData: VerdictRowDataV3 = {
      opportunityId: item.opportunityId,
      obsDate,
      scoringConfigVersion: SCORING_CONFIG_VERSION,
      verdict: item.output.verdict,
      lifecycle: item.output.lifecycle,
      dBasisPoints: item.output.dScore,
      mBasisPoints: item.output.mScore,
      wBasisPoints: item.output.wScore,
      confidence: item.output.confidence,
      inputSnapshotIds: [`snp_${item.opportunityId}_${obsDate}`],
      citedEvidenceIds: [],
      rawVerdict: item.output.rawVerdict,
      flags: item.output.flags,
      explanation: item.output.explanation,
      featuresHash: calculateFeaturesHash(item.featureMetrics),
      // 档位入账，窗口收窄检测才有逐日真值可比（不再读当前卡片快照）。
      dBand: item.output.dBand,
      mBand: item.output.mBand,
      wBand: item.output.wBand,
      predictionSpec: PredictionEpisodeService.isPredictionVerdict(item.output.verdict)
        ? predictionSpec
        : null,
    };
    return { opportunityId: item.opportunityId, data: rowData, hashVersion: 3 as const };
  });

  const dailyLedger =
    ledgerRows.length > 0
      ? generateDailyLedger(obsDate, ledgerRows, prevCheckpointHash, prevRowHash)
      : null;

  let alertsTriggered = 0;
  let episodesOpened = 0;
  const pendingEmails: Array<{ to: string; subject: string; body: string; idempotencyKey: string }> = [];

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
        const v2 = isV2Row(row.data) ? row.data : null;
        // v3 行的规格：`null` 是"这一行没有预测"，与"旧格式行"不同，所以用
        // isV3Row（判键存在）而不是真值判断。
        const spec = isV3Row(row.data) ? row.data.predictionSpec : null;
        await client.query(
          `INSERT INTO verdicts (
            id, opportunity_id, obs_date, scoring_config_version,
            verdict, raw_verdict, lifecycle, d_basis_points, m_basis_points, w_basis_points,
            confidence, input_snapshot_ids, cited_evidence_ids,
            flags, explanation, features_hash, hash_version,
            d_band, m_band, w_band,
            prediction_spec,
            prev_hash, row_hash
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
          )`,
          [
            `vdt_${row.opportunityId}_${obsDate.replace(/-/g, '')}`,
            row.opportunityId,
            obsDate,
            row.data.scoringConfigVersion,
            row.data.verdict,
            v2 ? v2.rawVerdict : null,
            row.data.lifecycle,
            row.data.dBasisPoints,
            row.data.mBasisPoints,
            row.data.wBasisPoints,
            row.data.confidence,
            row.data.inputSnapshotIds,
            row.data.citedEvidenceIds,
            // v1 行保持 NULL：空数组会与"本期确实没有任何标志"混为一谈。
            v2 ? v2.flags : null,
            v2 ? JSON.stringify(v2.explanation) : null,
            v2 ? v2.featuresHash : null,
            row.hashVersion,
            v2 ? v2.dBand : null,
            v2 ? v2.mBand : null,
            v2 ? v2.wBand : null,
            // JSON.stringify(null) 会写进 SQL NULL —— 与 hash 输入里的 null 一致，
            // 因为 hashing 也把"没有预测"编码成 null（而不是省略该键）。
            spec === null ? null : JSON.stringify(spec),
            row.prevHash,
            row.rowHash,
          ]
        );

        // A published BUILD NOW / EARLY BET is a prediction, and the public
        // Track Record is built from those. Opening the episode in the same
        // transaction as its verdict keeps the two from ever disagreeing.
        const source = publishable.find((item) => item.opportunityId === row.opportunityId);
        if (source) {
          const opened = await PredictionEpisodeService.recordEpisode(client, {
            opportunityId: row.opportunityId,
            verdictId: `vdt_${row.opportunityId}_${obsDate.replace(/-/g, '')}`,
            verdict: row.data.verdict,
            previousVerdict: source.previousVerdict,
            obsDate,
          });
          if (opened) episodesOpened++;
        }
      }

      await client.query(
        `INSERT INTO ledger_checkpoints (id, obs_date, total_records, merkle_root, final_row_hash, checkpoint_hash, signature)
         VALUES ($1,$2,$3,$4,$5,$6,'unsigned')`,
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
      rule_type: string;
      email: string;
    }>(
      `SELECT r.id, r.user_id, r.opportunity_id, r.rule_type, u.email
       FROM alert_rules r
       JOIN users u ON u.id = r.user_id
       WHERE r.is_active = true`
    );

    const killCache = new Map<string, boolean | null>();

    for (const rule of rulesRes.rows) {
      // 只求值**已实现且可订阅**的类型（`alert.service.createAlertRule` 用同一个判据
      // 拒绝其余类型）。库里的历史行（例如已删除的槽位触发器）会在阶段 F 的 0020
      // 之前继续存在，这里必须显式跳过，而不是让它们走进下面的 switch。
      if (!isEvaluatedRuleType(rule.rule_type)) continue;

      // 求值只看已发布（publishable）的观测：未发布意味着证据链不完整或采集失败，
      // 拿它去判定"裁决变了"会发出基于残缺数据的告警。
      const match = publishable.find((item) => item.opportunityId === rule.opportunity_id);
      if (!match) continue;

      // 04 §2 / ADR-021：STALE_DATA 期间不得投递 Verdict 变化类降级告警。
      // 机会仍会按旧快照评分，但不能让一次采集故障读成"竞争格局变了"。
      if (
        (match.output.flags ?? []).includes('STALE_DATA') &&
        (rule.rule_type === 'VERDICT_CHANGE' || rule.rule_type === 'WINDOW_CLOSING')
      ) {
        continue;
      }

      // KILL_CRITERIA：任一 ACTIVE 谓词今天求值为真即触发；全部无法求值（指标缺失或
      // 谓词畸形）则为 null，不当作"没触发"。触发的谓词落 TRIGGERED，避免次日重复响。
      // 按机会缓存：谓词是机会级的，而首个订阅者的求值会把命中的行翻成 TRIGGERED，
      // 第二个订阅者再查 ACTIVE 就查不到了——不缓存的话只有排第一的人收得到告警。
      let killTriggered: boolean | null | undefined;
      if (rule.rule_type === 'KILL_CRITERIA') {
        if (!killCache.has(rule.opportunity_id)) {
          const metrics = {
            weak_result_ratio: match.weakResultRatio,
            d_basis_points: match.output.dScore,
            m_basis_points: match.output.mScore,
            w_basis_points: match.output.wScore,
          };
          const kcRows = await client.query<{ id: string; predicate_dsl: unknown }>(
            `SELECT id, predicate_dsl FROM kill_criteria
              WHERE opportunity_id = $1 AND status = 'ACTIVE'`,
            [rule.opportunity_id]
          );
          const results = kcRows.rows.map((kc) => ({
            id: kc.id,
            result: evaluateKillPredicate(kc.predicate_dsl, metrics),
          }));
          const hit = results.filter((r) => r.result === true);
          if (hit.length > 0) {
            await client.query(
              `UPDATE kill_criteria SET status = 'TRIGGERED', triggered_at = NOW()
                WHERE id = ANY($1::text[]) AND status = 'ACTIVE'`,
              [hit.map((r) => r.id)]
            );
          }
          killCache.set(
            rule.opportunity_id,
            hit.length > 0 ? true : results.some((r) => r.result === false) ? false : null
          );
        }
        killTriggered = killCache.get(rule.opportunity_id);
      }

      // CUSTOM_QUERY_PULSE_CONFIRMED：只有当这条机会来自用户自定义词初筛
      // （`discovery_source='LIVE_SCAN'`）且本轮走 7 天快车道时才参与求值。
      let fromCustomQuery: boolean | undefined;
      if (rule.rule_type === 'CUSTOM_QUERY_PULSE_CONFIRMED') {
        const sourceRes = await client.query<{ discovery_source: string | null }>(
          `SELECT discovery_source FROM opportunities WHERE id = $1`,
          [rule.opportunity_id]
        );
        fromCustomQuery =
          sourceRes.rows[0]?.discovery_source === 'LIVE_SCAN' &&
          (match.output.flags ?? []).includes('FAST_TRACK');
      }

      // CROWDING_SIGNAL：当日计数来自 crowding_daily，上一次推送的读数来自
      // crowding_alert_state（按规则保存）。没有当日行就不求值。
      let crowding: CrowdingFacts | undefined;
      if (rule.rule_type === 'CROWDING_SIGNAL') {
        const today = await loadCrowding(rule.opportunity_id, obsDate);
        if (!today) continue;
        const stateRes = await client.query<{
          last_verified_product_count: number | null;
          last_new_top10_entrants_30d: number | null;
        }>(
          `SELECT last_verified_product_count, last_new_top10_entrants_30d
             FROM crowding_alert_state WHERE rule_id = $1`,
          [rule.id]
        );
        const prior = stateRes.rows[0];
        crowding = {
          verifiedProductCount: today.verifiedProductCount,
          previousVerifiedProductCount: prior?.last_verified_product_count ?? null,
          newTop10Entrants30d: today.newTop10Entrants30d,
          previousNewTop10Entrants30d: prior?.last_new_top10_entrants_30d ?? null,
        };
      }

      const fires = evaluateAlertTrigger(rule.rule_type, {
        verdict: match.output.verdict,
        previousVerdict: match.previousVerdict,
        killTriggered,
        crowding,
        fromCustomQuery,
      });
      if (fires !== true) continue;

      const title =
        rule.rule_type === 'WINDOW_CLOSING'
          ? `Entry window closing: ${match.title}`
          : rule.rule_type === 'CROWDING_SIGNAL'
          ? `Crowding rising: ${match.title}`
          : rule.rule_type === 'CUSTOM_QUERY_PULSE_CONFIRMED'
          ? `Custom query pulse confirmed: ${match.title}`
          : rule.rule_type === 'KILL_CRITERIA'
          ? `Kill criterion triggered: ${match.title}`
          : `Verdict changed: ${match.title}`;
      const body =
        rule.rule_type === 'WINDOW_CLOSING'
          ? `${match.primaryQuery} entered WINDOW_CLOSING. ${match.whyNowSummary}`
          : rule.rule_type === 'CROWDING_SIGNAL'
          ? `${match.primaryQuery}: ${crowding?.verifiedProductCount ?? 0} verified products and ${
              crowding?.newTop10Entrants30d ?? 0
            } new Top-10 entrant(s) in the last 30 days. Competition is intensifying; this does not limit GO.`
          : rule.rule_type === 'CUSTOM_QUERY_PULSE_CONFIRMED'
          ? `${match.primaryQuery}: your custom query confirmed a 7-day demand pulse and is now BUILD_NOW. Move before the window closes.`
          : rule.rule_type === 'KILL_CRITERIA'
          ? `${match.primaryQuery}: a stated stop condition was met today. Re-check the kill criteria on the report before building further.`
          : `${match.primaryQuery} moved from ${match.previousVerdict} to ${match.output.verdict}. ${match.whyNowSummary}`;
      await client.query(
        `INSERT INTO notifications (id, user_id, title, body, opportunity_id)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [`ntf_${obsDate}_${rule.id}`, rule.user_id, title, body, rule.opportunity_id]
      );
      if (rule.rule_type === 'CROWDING_SIGNAL' && crowding) {
        await client.query(
          `INSERT INTO crowding_alert_state (
             rule_id, last_verified_product_count, last_new_top10_entrants_30d, last_fired_on, updated_at
           ) VALUES ($1, $2, $3, $4::date, NOW())
           ON CONFLICT (rule_id) DO UPDATE SET
             last_verified_product_count = EXCLUDED.last_verified_product_count,
             last_new_top10_entrants_30d = EXCLUDED.last_new_top10_entrants_30d,
             last_fired_on = EXCLUDED.last_fired_on,
             updated_at = NOW()`,
          [
            rule.id,
            crowding.verifiedProductCount,
            crowding.newTop10Entrants30d,
            obsDate,
          ]
        );
      }
      alertsTriggered++;
      pendingEmails.push({ to: rule.email, subject: title, body, idempotencyKey: `alert/${rule.id}/${obsDate}` });
    }
  });

  // 雷达确认必须在告警事务提交之后：它自己开事务，嵌在上面的连接里会卡死。
  await CustomQueryRadarService.confirmDue(obsDate);

  for (const email of pendingEmails) {
    await deliverAlertEmail(email.to, email.subject, email.body, email.idempotencyKey);
  }

  // 蚕食索引（15 §3 第 3 条）按**本轮**构建一次，透传给整批机会。按次自加载的话，N 条机会
  // 每条都要拉一遍全量已收录集合，行数是 N × 10M 量级——透传不是优化而是必需。
  const cannibalizationIndex = await buildCannibalizationIndex('en-US');
  for (const item of observed) {
    await PublicPublicationService.publishOpportunity(item.opportunityId, 'en-US', { cannibalizationIndex }).catch((error) => {
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
      episodesOpened,
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

/**
 * Thin alias for the shared sender. Kept as a named function so the call sites in
 * this file read the same as before, but the implementation no longer exists here:
 * it used to be a second copy of the Resend call that swallowed every failure,
 * including a 4xx from Resend.
 */
async function deliverAlertEmail(to: string, subject: string, text: string, idempotencyKey: string): Promise<void> {
  await sendTransactionalEmail({ to, subject, text, idempotencyKey });
}
