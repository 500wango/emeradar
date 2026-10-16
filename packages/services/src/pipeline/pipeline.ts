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
import {
  detectNewAuthoritativeEntrant,
  evaluateAlertTrigger,
  SerpEntrantRow,
  SerpEntrantSnapshot,
} from '../alert-triggers';
import { discoverAutocompleteCandidates } from './discover-candidates';
import { SlotService } from '../slot.service';
import { stealthHiddenPredicate } from '../stealth-lock-policy';

const PIPELINE_LOCK_ID = 481516;

/** 纯日期算术，不读挂钟：同一 obsDate 必得同一对照日。 */
function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 取出某机会主查询的"当日 Top10"与"7 天前 Top10"，供 `NEW_ENTRANT` 判定新进入者。
 *
 * 对照日取"**不晚于** `obsDate - 7` 的最近一份快照"，而不是严格要求恰好 7 天前那
 * 一天：采集有缺口时，后者会查不到任何东西，于是"没有对照组"会被静默读成"没有新
 * 进入者"——那正好是这条规则本该报警的情形。缺对照时宁可返回 null，让规则显式
 * 不求值（`evaluateAlertTrigger` 返回 null），也不要给出一个基于缺失数据的 false。
 */
async function loadSerpEntrants(
  client: { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> },
  opportunityId: string,
  obsDate: string
): Promise<SerpEntrantSnapshot | null> {
  const primaryRes = await client.query(
    `SELECT oq.query_id FROM opportunity_queries oq
      WHERE oq.opportunity_id = $1 AND oq.role = 'PRIMARY'`,
    [opportunityId]
  );
  const queryId = primaryRes.rows[0]?.query_id as string | undefined;
  if (!queryId) return null;

  const top10AtOrBefore = async (cutoff: string): Promise<SerpEntrantRow[] | null> => {
    const snapRes = await client.query(
      `SELECT id FROM serp_snapshots
        WHERE query_id = $1 AND obs_date <= $2::date
        ORDER BY obs_date DESC LIMIT 1`,
      [queryId, cutoff]
    );
    const snapshotId = snapRes.rows[0]?.id as string | undefined;
    if (!snapshotId) return null;
    const rowsRes = await client.query(
      `SELECT rank, domain, result_type FROM serp_results
        WHERE serp_snapshot_id = $1 AND rank <= 10
        ORDER BY rank`,
      [snapshotId]
    );
    return rowsRes.rows.map((row) => ({
      rank: Number(row.rank),
      domain: String(row.domain),
      resultType: String(row.result_type),
    }));
  };

  const today = await top10AtOrBefore(obsDate);
  const prior = await top10AtOrBefore(daysBefore(obsDate, 7));
  if (!today || !prior) return null;
  return { today, prior };
}

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
  /** 保护期内被压下的告警投递数（见下方 `stealthHolders`）。 */
  let stealthSuppressed = 0;
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

      // 槽位在机会首次可被认领时物化一次，此后不再变。放在这里而不是"读的时候顺手
      // 建"，是因为集合一旦落地就冻结（见 SlotService.materialize）：每日按新的
      // top-3 增删会让 Σcapacity 越过上限，而删行会连同已认领的记录一起丢掉。
      // ON CONFLICT DO NOTHING 保证了重复调用无副作用。
      if (targetStatus === 'TRACKED') {
        await SlotService.materialize(
          client,
          item.opportunityId,
          item.output.topArchetypes.map((entry) => entry.archetype)
        );
      }
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

    // NEW_ENTRANT 要读 SERP 快照。同一机会可能挂着多条规则，按机会缓存 ——
    // 这几次查询在同一事务里重复跑没有意义。
    const entrantCache = new Map<string, SerpEntrantSnapshot | null>();
    const killCache = new Map<string, boolean | null>();
    const lastSlotCache = new Map<string, boolean>();

    /**
     * 买断保护期内的机会：**只对持有者投递**（10 §7、16 §3.3）。
     *
     * 这一道闸拦的不是"新建规则"——那个入口已经挡住了（`alert.service.ts` 的存在性
     * 判据）。它拦的是**买断之前就建好的规则**：一个非持有者在第 N 天订阅了某条机会，
     * 平台在第 N+10 天把它卖了出去，于是第 N+20 天规则命中，一封带着真实词根、真实
     * 标题和一串可点链接的邮件就发到了一个刚被排除在外的用户手里。这条路径上没有任何
     * 一处会报错，而它是 P0 泄露——`docs/15 §8` 对正文与 slug 是 0 容忍，邮件正文
     * 用的正是同一份 `match.primaryQuery` 与 `match.title`。
     *
     * 一次查完按机会缓存，理由与 `entrantCache` 相同：同一机会挂多条规则时不该重复查。
     */
    const ruleOpportunityIds = [...new Set(rulesRes.rows.map((rule) => rule.opportunity_id))];
    const stealthHolders = new Map<string, string>();
    if (ruleOpportunityIds.length > 0) {
      const hiddenRes = await client.query<{ opportunity_id: string; user_id: string }>(
        `SELECT sl.opportunity_id, sl.user_id FROM stealth_locks sl
          WHERE sl.opportunity_id = ANY($1::text[]) AND ${stealthHiddenPredicate('sl')}`,
        [ruleOpportunityIds]
      );
      for (const row of hiddenRes.rows) stealthHolders.set(row.opportunity_id, row.user_id);
    }

    for (const rule of rulesRes.rows) {
      const holder = stealthHolders.get(rule.opportunity_id);
      if (holder && holder !== rule.user_id) {
        stealthSuppressed++;
        continue;
      }
      // 求值只看已发布（publishable）的观测：未发布意味着证据链不完整或采集失败，
      // 拿它去判定"裁决变了"会发出基于残缺数据的告警。无法求值的类型返回 null，
      // 这里显式跳过 —— 创建入口已经拒绝了尚未实现的类型，走到这里说明库里有历史行。
      const match = publishable.find((item) => item.opportunityId === rule.opportunity_id);
      if (!match) continue;

      let serpEntrants: SerpEntrantSnapshot | undefined;
      let entrant: ReturnType<typeof detectNewAuthoritativeEntrant> = null;
      if (rule.rule_type === 'NEW_ENTRANT') {
        if (!entrantCache.has(rule.opportunity_id)) {
          entrantCache.set(rule.opportunity_id, await loadSerpEntrants(client, rule.opportunity_id, obsDate));
        }
        const snapshot = entrantCache.get(rule.opportunity_id);
        // 没有可用的 SERP 对照就不求值：宁可今天不响，也不要基于缺失数据断言
        // "没有新的权威进场"。
        if (!snapshot) continue;
        serpEntrants = snapshot;
        entrant = detectNewAuthoritativeEntrant(snapshot);
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

      // SLOTS_LAST_ONE：某一形态剩余槽位恰为 1（ADR-018）。只在"进入"那一天提醒一次：
      // 该规则已有过通知就不再重复，否则槽位停在 1 的每一天都会响。
      let slotsLastOne: boolean | null | undefined;
      if (rule.rule_type === 'SLOTS_LAST_ONE') {
        if (!lastSlotCache.has(rule.opportunity_id)) {
          const slotRes = await client.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM opportunity_slots
              WHERE opportunity_id = $1 AND capacity - claimed = 1`,
            [rule.opportunity_id]
          );
          lastSlotCache.set(rule.opportunity_id, (slotRes.rows[0]?.n ?? 0) > 0);
        }
        slotsLastOne = lastSlotCache.get(rule.opportunity_id);
        if (slotsLastOne) {
          const prior = await client.query(
            `SELECT 1 FROM notifications WHERE id LIKE $1 LIMIT 1`,
            [`ntf\\_%\\_${rule.id}`]
          );
          if (prior.rows.length > 0) slotsLastOne = false;
        }
      }

      const fires = evaluateAlertTrigger(rule.rule_type, {
        slotsLastOne,
        verdict: match.output.verdict,
        previousVerdict: match.previousVerdict,
        serpEntrants,
        killTriggered,
      });
      if (fires !== true) continue;

      const title =
        rule.rule_type === 'WINDOW_CLOSING'
          ? `Entry window closing: ${match.title}`
          : rule.rule_type === 'SLOTS_LAST_ONE'
          ? `Last slot left: ${match.title}`
          : rule.rule_type === 'KILL_CRITERIA'
          ? `Kill criterion triggered: ${match.title}`
          : rule.rule_type === 'NEW_ENTRANT'
          ? `Authoritative entrant in the Top 10: ${match.title}`
          : `Verdict changed: ${match.title}`;
      const body =
        rule.rule_type === 'WINDOW_CLOSING'
          ? `${match.primaryQuery} entered WINDOW_CLOSING. ${match.whyNowSummary}`
          : rule.rule_type === 'SLOTS_LAST_ONE'
          ? `${match.primaryQuery}: exactly one build slot is left on at least one track. ${match.whyNowSummary}`
          : rule.rule_type === 'KILL_CRITERIA'
          ? `${match.primaryQuery}: a stated stop condition was met today. Re-check the kill criteria on the report before building further.`
          : rule.rule_type === 'NEW_ENTRANT'
          ? `${match.primaryQuery}: ${entrant?.domain} entered the Top 10 at #${entrant?.rank} as ${entrant?.resultType}, and was absent from the top 10 seven days ago. ${match.whyNowSummary}`
          : `${match.primaryQuery} moved from ${match.previousVerdict} to ${match.output.verdict}. ${match.whyNowSummary}`;
      await client.query(
        `INSERT INTO notifications (id, user_id, title, body, opportunity_id)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [`ntf_${obsDate}_${rule.id}`, rule.user_id, title, body, rule.opportunity_id]
      );
      alertsTriggered++;
      pendingEmails.push({ to: rule.email, subject: title, body, idempotencyKey: `alert/${rule.id}/${obsDate}` });
    }
  });

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
    `[pipeline] Observed ${observed.length}. Published ${publishable.length}. Alerts ${alertsTriggered}.` +
      (stealthSuppressed > 0 ? ` Stealth-suppressed ${stealthSuppressed}.` : '')
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
