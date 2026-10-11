import { query } from '@emeradar/db';
import {
  MerkleTree,
  calculateCheckpointHash,
  GENESIS_PREV_HASH,
  verifyRowHash,
  buildRowHashInput,
  LedgerRowRecord,
} from '@emeradar/ledger';

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
    const hitRate30d =
      evaluated.length > 0 ? Math.round((hits / evaluated.length) * 1000) / 10 : null;

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

        return {
          month,
          total: cohortEpisodes.length,
          hitRate30d: eval30.length > 0 ? `${Math.round((hits30 / eval30.length) * 1000) / 10}%` : '—',
          hitRate60d: eval60.length > 0 ? `${Math.round((hits60 / eval60.length) * 1000) / 10}%` : '—',
          hitRate90d: eval90.length > 0 ? `${Math.round((hits90 / eval90.length) * 1000) / 10}%` : '—',
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
        hitRate30d: hitRate30d === null ? null : `${hitRate30d}%`,
        activeWatchlistCount: Number(watchlistRes.rows[0]?.count ?? 0),
      },
      episodes,
      cohorts,
      checkpoints: ckpRes.rows,
    };
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
      throw new Error(`No checkpoint found for date ${obsDate}`);
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

    // Fetch verdicts for that date sorted by opportunity_id
    const verdictsRes = await query<LedgerRowRecord>(
      `SELECT opportunity_id, obs_date::text, scoring_config_version, verdict, lifecycle,
              d_basis_points, m_basis_points, w_basis_points, confidence,
              input_snapshot_ids, cited_evidence_ids, prev_hash, row_hash,
              raw_verdict, flags, explanation, features_hash, hash_version,
              d_band, m_band, w_band
       FROM verdicts WHERE obs_date = $1 ORDER BY opportunity_id COLLATE "C" ASC`,
      [obsDate]
    );

    let previousHash = previousCheckpointRes.rows[0]?.final_row_hash || GENESIS_PREV_HASH;
    const rowHashes: string[] = [];
    let rowsValid = true;
    for (const row of verdictsRes.rows) {
      // 版本由 hash_version 列决定，字段集必须与写入时一致。v2 行把依据字段
      // 纳入了哈希，若仍按 v1 的 11 个字段重算，账本一旦出现 v2 行，这一天的
      // 公开验证就会整体报失败 —— 而公开可验证正是账本存在的理由。
      // 残缺的 v2 行由 verifyRowHash 判为"验不过"而非抛异常（见 isCompleteV2Row）。
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
        : calculateCheckpointHash(
            previousCheckpointRes.rows[0]?.checkpoint_hash || previousHash,
            obsDate,
            rowHashes.length,
            calculatedRoot
          );
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
