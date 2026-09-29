import { query } from '@emeradar/db';
import { MerkleTree, calculateRowHash, GENESIS_PREV_HASH } from '@emeradar/ledger';

export class TrackRecordService {
  /**
   * Get public track record summary, historical episodes, and checkpoints
   */
  static async getPublicTrackRecord(): Promise<any> {
    // 1. Overall stats from prediction_episodes
    const episodesRes = await query<any>(
      `SELECT e.*, o.title as opportunity_title, o.slug as opportunity_slug
       FROM prediction_episodes e
       JOIN opportunities o ON o.id = e.opportunity_id
       ORDER BY e.predicted_at DESC`
    );

    const episodes = episodesRes.rows;
    const evaluated = episodes.filter(
      (e) => e.outcome_30d === 'HIT' || e.outcome_30d === 'MISS'
    );
    const hits = evaluated.filter((e) => e.outcome_30d === 'HIT').length;
    const hitRate30d =
      evaluated.length > 0 ? Math.round((hits / evaluated.length) * 1000) / 10 : null;

    // 2. Checkpoints
    const ckpRes = await query<any>(
      `SELECT id, obs_date, total_records, merkle_root, final_row_hash, verified_at
       FROM ledger_checkpoints
       ORDER BY obs_date DESC
       LIMIT 30`
    );

    return {
      stats: {
        totalPredictions: episodes.length,
        evaluatedEpisodes: evaluated.length,
        hitsCount: hits,
        hitRate30d: hitRate30d === null ? null : `${hitRate30d}%`,
        activeWatchlistCount: episodes.length,
      },
      episodes,
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

    const previousCheckpointRes = await query<{ final_row_hash: string }>(
      `SELECT final_row_hash
       FROM ledger_checkpoints
       WHERE obs_date < $1
       ORDER BY obs_date DESC
       LIMIT 1`,
      [obsDate]
    );

    // Fetch verdicts for that date sorted by opportunity_id
    const verdictsRes = await query<{
      opportunity_id: string; obs_date: string; scoring_config_version: string;
      verdict: any; lifecycle: any; d_basis_points: number; m_basis_points: number;
      w_basis_points: number; confidence: any; input_snapshot_ids: string[];
      cited_evidence_ids: string[]; prev_hash: string; row_hash: string;
    }>(
      `SELECT opportunity_id, obs_date::text, scoring_config_version, verdict, lifecycle,
              d_basis_points, m_basis_points, w_basis_points, confidence,
              input_snapshot_ids, cited_evidence_ids, prev_hash, row_hash
       FROM verdicts WHERE obs_date = $1 ORDER BY opportunity_id ASC`,
      [obsDate]
    );

    let previousHash = previousCheckpointRes.rows[0]?.final_row_hash || GENESIS_PREV_HASH;
    const rowHashes: string[] = [];
    let rowsValid = true;
    for (const row of verdictsRes.rows) {
      const data = {
        opportunityId: row.opportunity_id,
        obsDate: row.obs_date,
        scoringConfigVersion: row.scoring_config_version,
        verdict: row.verdict,
        lifecycle: row.lifecycle,
        dBasisPoints: row.d_basis_points,
        mBasisPoints: row.m_basis_points,
        wBasisPoints: row.w_basis_points,
        confidence: row.confidence,
        inputSnapshotIds: row.input_snapshot_ids || [],
        citedEvidenceIds: row.cited_evidence_ids || [],
      };
      const calculated = calculateRowHash(previousHash, data);
      rowsValid = rowsValid && row.prev_hash === previousHash && row.row_hash === calculated;
      rowHashes.push(row.row_hash);
      previousHash = row.row_hash;
    }
    const tree = new MerkleTree(rowHashes);
    const calculatedRoot = tree.getRoot();

    return {
      verified: rowsValid && expectedCount === rowHashes.length && storedRoot.toLowerCase() === calculatedRoot.toLowerCase(),
      obsDate,
      storedMerkleRoot: storedRoot,
      calculatedMerkleRoot: calculatedRoot,
      rowCount: rowHashes.length,
    };
  }
}
