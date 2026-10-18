import { query } from '@emeradar/db';
import { AppError } from '@emeradar/core';
import {
  MerkleTree,
  calculateCheckpointHash,
  GENESIS_PREV_HASH,
  verifyRowHash,
  buildRowHashInput,
  LedgerRowRecord,
} from '@emeradar/ledger';
import { evaluateLostFirstMoverValue, loadLostValueFacts } from './publication-policy';

/**
 * 单边样本不出比率 —— docs/16 §3.1a 的强制口径，导出的纯函数便于直接测。
 *
 * "有命中、无未命中" 与 "有未命中、无命中" 都算单边：前者可能只是一个还没被
 * 证伪的样本，后者是样本量不足。两者都不能支撑一个百分比。计数照常返回，
 * 调用方要展示就只能展示 `hits/evaluated`。
 */
export function rateIfTwoSided(hitCount: number, evaluatedCount: number): string | null {
  if (evaluatedCount === 0 || hitCount === 0 || hitCount === evaluatedCount) return null;
  return `${Math.round((hitCount / evaluatedCount) * 1000) / 10}%`;
}

/**
 * 公开战报里一条 Episode 允许外露的字段**白名单**。
 *
 * 写成白名单而不是"取 `e.*` 再覆盖几个字段"，是因为这两种写法在**将来**的行为完全
 * 不同：给 `prediction_episodes` 加一列时，白名单天然不泄露，覆盖法默认泄露，而要
 * 发现它得有人记得回来看这个文件。`docs/15 §8` 把真实词根外泄定成 0 容忍，靠"记得"
 * 守不住。
 *
 * 顺带把 `criteria_snapshot` 与 `metrics.observed` 挡在外面：两者都是 `JSONB` 自由
 * 字段，内容不做保证——`observed` 的具体形态取决于评估器当天的写入，没有理由让它
 * 出现在一个未登录就能读的响应里。公开页真正用到的只有 `clusterExpansion` 与
 * `windowClosed`（见 `apps/web/src/app/track-record/page.tsx` 的 `observedMetric`），
 * 所以 `metrics` 也只放这两个键。
 */
const PUBLIC_EPISODE_FIELDS = [
  'id',
  // C 阶段删除打码分支时把这两行一起删了，页面上的机会列与链接因此变成空白
  // 与 `/opportunities/undefined`。v3.1 没有打码，标题与 slug 始终是公开的。
  'opportunity_title',
  'opportunity_slug',
  'published_verdict',
  'predicted_at',
  'outcome_30d',
  'outcome_60d',
  'outcome_90d',
  'evaluated_30d_at',
  'evaluated_60d_at',
  'evaluated_90d_at',
] as const;

const PUBLIC_METRIC_HORIZONS = ['h30', 'h60', 'h90'] as const;
const PUBLIC_METRIC_KEYS = ['clusterExpansion', 'windowClosed'] as const;

/** 只放出公开页真正渲染的两个聚合键，其余（`observed` 等自由字段）一律不带出。 */
function projectPublicMetrics(metrics: unknown): Record<string, unknown> {
  const source = (metrics ?? {}) as Record<string, any>;
  const out: Record<string, unknown> = {};
  for (const horizon of PUBLIC_METRIC_HORIZONS) {
    const entry = source[horizon];
    if (!entry || typeof entry !== 'object') continue;
    const picked: Record<string, unknown> = {};
    for (const key of PUBLIC_METRIC_KEYS) {
      if (entry[key] !== undefined) picked[key] = entry[key];
    }
    out[horizon] = picked;
  }
  return out;
}

export class TrackRecordService {
  /**
   * Get public track record summary, historical episodes, and checkpoints
   */
  static async getPublicTrackRecord(): Promise<any> {
    // 1. 汇总纳入 v2 纪元内**全部**已发布 Episode，不再按天数延迟（PRD v2.2 Q11、06 §11）：
    //    只统计已失去抢跑价值的机会会系统性剔除无人认领的失误。逐行明细另行披露：
    //    「失去抢跑价值」或「完成 T+90 评估」两者先到者。判据与公开投影同源
    //    （`evaluateLostFirstMoverValue`），但方向相反：这里的披露只决定**明细**是否
    //    对外出现，`stats` 与 `cohorts` 永远用全量（命中与失误都必须留在统计里）。
    //    有界，未登录请求扫不了整本账本。
    const episodesRes = await query<any>(
      `SELECT e.*, o.title as opportunity_title, o.slug as opportunity_slug
       FROM prediction_episodes e
       JOIN opportunities o ON o.id = e.opportunity_id
       JOIN verdicts v ON v.id = e.verdict_id
       WHERE o.status = 'TRACKED'
         -- 账本纪元（06 §5、30 R3）：hash_version = 1 的存量行由 seed 伪造、不可复算，
         -- 不得进入任何公开统计，也不计入 Gate 1「账本运行 ≥ 60 天」。
         AND v.hash_version >= 2
       ORDER BY e.predicted_at DESC
       LIMIT 500`
    );

    const episodes = episodesRes.rows;
    // 逐行披露判据：T+90 出结果，或这条机会已经失去抢跑价值。一次取齐事实，避免
    // 每个 Episode 一次往返（最多 500 行）。
    const episodeFacts = await loadLostValueFacts(episodes.map((e: any) => e.opportunity_id));
    for (const episode of episodes) {
      const facts = episodeFacts.get(episode.opportunity_id);
      episode.disclosed =
        episode.outcome_90d === 'HIT' ||
        episode.outcome_90d === 'MISS' ||
        (facts ? evaluateLostFirstMoverValue(facts).eligible : false);
    }
    const evaluated = episodes.filter(
      (e) => e.outcome_30d === 'HIT' || e.outcome_30d === 'MISS'
    );
    const hits = evaluated.filter((e) => e.outcome_30d === 'HIT').length;

    /**
     * 单边样本不出比率，这条规则在**服务层**，不只在页面上。
     *
     * 此前它只写在 `/track-record` 的 `accuracy()` 里，于是任何绕过页面的消费方
     * —— 公开 API `/api/v1/public/track-record`、首页遥测
     * `observatory/telemetry.ts`、以及任何第三方 —— 拿到的仍是 `1/1 = 100%`。
     * 比率是产品可信度本身，不能靠"调用方记得自己拦"。
     */
    const hitRate30d = rateIfTwoSided(hits, evaluated.length);

    // 06 §7.1a：缺外部数据源的地平线记为 UNEVALUABLE，不计分母，但必须单独报告其占比。
    // 占比 > 30% 时 H1 结论不得引用，所以这个数字不能只留在库里。
    const unevaluable30d = episodes.filter((e) => e.outcome_30d === 'UNEVALUABLE').length;
    const gradedOrUnevaluable = evaluated.length + unevaluable30d;

    // 2. Cohort Hit-Rate Matrix (grouped by predicted_at month)
    const cohortMap = new Map<string, any[]>();
    for (const ep of episodes) {
      if (!ep.predicted_at) continue;
      const month = new Date(ep.predicted_at).toISOString().slice(0, 7);
      if (!cohortMap.has(month)) cohortMap.set(month, []);
      cohortMap.get(month)!.push(ep);
    }

    const cohorts = Array.from(cohortMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, cohortEpisodes]) => {
        const eval30 = cohortEpisodes.filter((e) => e.outcome_30d === 'HIT' || e.outcome_30d === 'MISS');
        const hits30 = eval30.filter((e) => e.outcome_30d === 'HIT').length;
        const eval60 = cohortEpisodes.filter((e) => e.outcome_60d === 'HIT' || e.outcome_60d === 'MISS');
        const hits60 = eval60.filter((e) => e.outcome_60d === 'HIT').length;
        const eval90 = cohortEpisodes.filter((e) => e.outcome_90d === 'HIT' || e.outcome_90d === 'MISS');
        const hits90 = eval90.filter((e) => e.outcome_90d === 'HIT').length;

        // The hit *counts* travel alongside the rate: a null rate is either
        // "nothing evaluated yet" or "one-sided sample", and the caller cannot
        // tell which from the rate alone. Counts let the page say which.
        return {
          month,
          total: cohortEpisodes.length,
          hitRate30d: rateIfTwoSided(hits30, eval30.length),
          hitRate60d: rateIfTwoSided(hits60, eval60.length),
          hitRate90d: rateIfTwoSided(hits90, eval90.length),
          hits30,
          eval30: eval30.length,
          hits60,
          eval60: eval60.length,
          hits90,
          eval90: eval90.length,
          sampleSize: cohortEpisodes.length,
          status: eval60.length > 0 ? 'MATURED' : eval30.length > 0 ? 'EVALUATING' : 'ACCUMULATING',
        };
      });

    // 3. Checkpoints
    const ckpRes = await query<any>(
      `SELECT id, obs_date, total_records, merkle_root, final_row_hash, verified_at
       FROM ledger_checkpoints
       ORDER BY obs_date DESC
       LIMIT 30`
    );

    // Number of opportunities currently under observation, independent of the
    // embargoed episode list above.
    const watchlistRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM opportunities WHERE status = 'TRACKED'`
    );

    // 公开战报一行都不许少：`stats` 与 `cohorts` 全部由未删减的 `episodes` 算出，
    // 明细只由 `disclosed` 过滤——那是"这一条该不该对外披露"，与可见性无关。
    // v3.1 没有买断，不存在"打码但保留"的第三条路，词根也不再需要替换。
    const publicEpisodes = episodes.filter((e: any) => e.disclosed).map((episode: any) => {
      const projected: Record<string, unknown> = {};
      for (const field of PUBLIC_EPISODE_FIELDS) projected[field] = episode[field];
      projected.metrics = projectPublicMetrics(episode.metrics);
      return projected;
    });

    // 4. Builder outcomes: 最新一次回访按 verdict 分组。样本 <30 时只返回计数，
    //    不对外给比例（06 §7.2：样本不足的 builder-outcome 只内部使用）。
    const builderRes = await query<{
      verdict: string;
      total: number;
      launched: number;
      traction: number;
      abandoned: number;
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON (project_id) project_id, status
           FROM project_outcome_checkins
          ORDER BY project_id, created_at DESC
       )
       SELECT COALESCE(c.verdict, 'UNKNOWN') AS verdict,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE l.status = 'LAUNCHED')::int AS launched,
              COUNT(*) FILTER (WHERE l.status IN ('EARLY_TRACTION','TRACTION'))::int AS traction,
              COUNT(*) FILTER (WHERE l.status = 'ABANDONED')::int AS abandoned
         FROM latest l
         JOIN projects p ON p.id = l.project_id
         LEFT JOIN opportunity_cards c ON c.opportunity_id = p.opportunity_id
        GROUP BY 1
        ORDER BY 1`
    );
    const builderSampleSize = builderRes.rows.reduce((sum, row) => sum + row.total, 0);
    const builderOutcomes = {
      sampleSize: builderSampleSize,
      minSample: 30,
      groups:
        builderSampleSize >= 30
          ? builderRes.rows.map((row) => ({
              verdict: row.verdict,
              total: row.total,
              launched: row.launched,
              traction: row.traction,
              abandoned: row.abandoned,
            }))
          : null,
    };

    return {
      stats: {
        totalPredictions: episodes.length,
        evaluatedEpisodes: evaluated.length,
        hitsCount: hits,
        hitRate30d,
        unevaluableEpisodes: unevaluable30d,
        unevaluableShare:
          gradedOrUnevaluable > 0 ? Math.round((unevaluable30d / gradedOrUnevaluable) * 1000) / 1000 : null,
        undisclosedEpisodes: episodes.filter((e: any) => !e.disclosed).length,
        activeWatchlistCount: Number(watchlistRes.rows[0]?.count ?? 0),
      },
      episodes: publicEpisodes,
      cohorts,
      builderOutcomes,
      checkpoints: ckpRes.rows,
    };
  }

  /**
   * 最新一条账本检查点的日期，账本还没开始时为 `null`。
   *
   * "最新"是验证入口唯一说得通的默认对象：账本只在有裁决的日子推进，所以"今天"
   * 常常根本没有检查点，而按今天去验会得到一个"失败"——那个失败说的是"今天没有
   * 账本"，不是"账本被改过"。这两件事必须能被分开，否则一个每天都会响的假 P0
   * 会把真正的账本告警淹掉。
   *
   * 定时任务与公开验证端点都从这里取默认日期，免得两处各自写一个 `MAX(obs_date)`。
   */
  static async latestCheckpointDate(): Promise<string | null> {
    const res = await query<{ obs_date: string | null }>(
      `SELECT MAX(obs_date)::text AS obs_date FROM ledger_checkpoints`
    );
    return res.rows[0]?.obs_date ?? null;
  }

  /**
   * Recompute and cryptographically verify Merkle root for a given date
   */
  static async verifyCheckpoint(obsDate: string): Promise<{
    verified: boolean;
    obsDate: string;
    storedMerkleRoot: string;
    calculatedMerkleRoot: string;
    rowCount: number;
  }> {
    const ckpRes = await query<{
      merkle_root: string;
      total_records: number;
    }>(
      `SELECT merkle_root, total_records FROM ledger_checkpoints WHERE obs_date = $1`,
      [obsDate]
    );

    if (ckpRes.rows.length === 0) {
      // 用 `notFound` 而不是裸 `Error`：公开验证端点要按"这一天的检查点不存在"回 404，
      // 而不是回一个笼统的 400。裸 Error 到了路由层只能被归成"请求有问题"，而请求
      // 本身可能是完全合法的——只是那一天没有账本。
      throw AppError.notFound(`Ledger checkpoint for ${obsDate}`);
    }

    const storedRoot = ckpRes.rows[0].merkle_root;
    const expectedCount = Number(ckpRes.rows[0].total_records);

    const previousCheckpointRes = await query<{ final_row_hash: string; checkpoint_hash: string | null }>(
      `SELECT final_row_hash, checkpoint_hash
       FROM ledger_checkpoints
       WHERE obs_date < $1
       ORDER BY obs_date DESC
       LIMIT 1`,
      [obsDate]
    );

    const checkpointRow = await query<{ checkpoint_hash: string | null }>(
      `SELECT checkpoint_hash FROM ledger_checkpoints WHERE obs_date = $1`,
      [obsDate]
    );
    const storedCheckpointHash = checkpointRow.rows[0]?.checkpoint_hash ?? null;

    // 链的两个起点必须在遍历**之前**固定下来，且必须与写入时用的那两个一致
    // （见 pipeline 的 prevRowHash / prevCheckpointHash，取法逐字对应）：
    //
    //   行链起点  = 前一日的链尾行哈希，账本第一日为 GENESIS
    //   检查点输入 = 前一日的 checkpoint_hash，退化到行链起点
    //
    // 从前这里是在遍历**之后**读 `previousHash` —— 那个变量已经被循环改写成
    // "当日最后一行的 row_hash"。于是账本第一日（没有前一日检查点）永远算不出
    // 写入时那个 checkpoint_hash，公开验证对第一天恒报失败；前一日 checkpoint_hash
    // 为 NULL 的那些天同理。改了会让已发布的默克尔根失效，所以写入侧不动，这里对齐。
    const prevRowHash = previousCheckpointRes.rows[0]?.final_row_hash || GENESIS_PREV_HASH;
    const prevCheckpointHash = previousCheckpointRes.rows[0]?.checkpoint_hash || prevRowHash;

    // Fetch verdicts for that date sorted by opportunity_id
    const verdictsRes = await query<LedgerRowRecord>(
      `SELECT opportunity_id, obs_date::text, scoring_config_version, verdict, lifecycle,
              d_basis_points, m_basis_points, w_basis_points, confidence,
              input_snapshot_ids, cited_evidence_ids, prev_hash, row_hash,
              raw_verdict, flags, explanation, features_hash, hash_version,
              d_band, m_band, w_band, prediction_spec
       FROM verdicts WHERE obs_date = $1 ORDER BY opportunity_id COLLATE "C" ASC`,
      [obsDate]
    );

    let previousHash = prevRowHash;
    const rowHashes: string[] = [];
    let rowsValid = true;
    for (const row of verdictsRes.rows) {
      // 版本由 hash_version 列决定，字段集必须与写入时一致。v2 行把依据字段
      // 纳入了哈希，v3 行再纳入预测规格。若仍按 v1 的 11 个字段重算，账本一旦
      // 出现 v2/v3 行，这一天的公开验证就会整体报失败 —— 而公开可验证正是账本
      // 存在的理由。**这份 SELECT 必须与字段集同步**：少选一列（例如
      // prediction_spec）会让带规格的 v3 行按"规格为 null"复算，同样整体报失败。
      // 残缺的行由 verifyRowHash 判为"验不过"而非抛异常（见 isCompleteV3Row）。
      const { data, hashVersion } = buildRowHashInput(row);

      rowsValid =
        rowsValid && row.prev_hash === previousHash && verifyRowHash(previousHash, data, row.row_hash, hashVersion);
      rowHashes.push(row.row_hash);
      previousHash = row.row_hash;
    }
    const tree = new MerkleTree(rowHashes);
    const calculatedRoot = tree.getRoot();

    // The checkpoint hash chains each day to the previous day's checkpoint, so a
    // rewritten-but-internally-consistent day still fails against its successor.
    const expectedCheckpointHash =
      storedCheckpointHash === null
        ? null
        : calculateCheckpointHash(prevCheckpointHash, obsDate, rowHashes.length, calculatedRoot);
    const checkpointValid =
      expectedCheckpointHash === null ||
      expectedCheckpointHash.toLowerCase() === storedCheckpointHash!.toLowerCase();

    return {
      verified:
        rowsValid &&
        checkpointValid &&
        expectedCount === rowHashes.length &&
        storedRoot.toLowerCase() === calculatedRoot.toLowerCase(),
      obsDate,
      storedMerkleRoot: storedRoot,
      calculatedMerkleRoot: calculatedRoot,
      rowCount: rowHashes.length,
    };
  }
}
