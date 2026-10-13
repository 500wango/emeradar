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

export class TrackRecordService {
  /**
   * Get public track record summary, historical episodes, and checkpoints
   */
  /** Public embargo before a prediction is disclosed on the marketing site. */
  static readonly PUBLIC_DELAY_DAYS = 45;

  static async getPublicTrackRecord(): Promise<any> {
    // 1. Overall stats from prediction_episodes.
    //    Public disclosure is limited to published opportunities that have
    //    cleared the same 45-day embargo used by public_pages, and is bounded
    //    so an unauthenticated request can never scan the whole ledger.
    const episodesRes = await query<any>(
      `SELECT e.*, o.title as opportunity_title, o.slug as opportunity_slug
       FROM prediction_episodes e
       JOIN opportunities o ON o.id = e.opportunity_id
       WHERE o.status = 'TRACKED'
         AND e.predicted_at <= (NOW() - ($1 || ' days')::interval)::date
       ORDER BY e.predicted_at DESC
       LIMIT 500`,
      [String(TrackRecordService.PUBLIC_DELAY_DAYS)]
    );

    const episodes = episodesRes.rows;
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

    return {
      stats: {
        totalPredictions: episodes.length,
        evaluatedEpisodes: evaluated.length,
        hitsCount: hits,
        hitRate30d,
        activeWatchlistCount: Number(watchlistRes.rows[0]?.count ?? 0),
      },
      episodes,
      cohorts,
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
