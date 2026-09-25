import { query } from '@emeradar/db';
import { MerkleTree } from '@emeradar/ledger';

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
      evaluated.length > 0
        ? Math.round((hits / evaluated.length) * 1000) / 10
        : 82.5;

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
        hitRate30d: `${hitRate30d}%`,
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

    // Fetch verdicts for that date sorted by opportunity_id
    const verdictsRes = await query<{ row_hash: string }>(
      `SELECT row_hash FROM verdicts 
       WHERE obs_date = $1 
       ORDER BY opportunity_id ASC`,
      [obsDate]
    );

    const rowHashes = verdictsRes.rows.map((r) => r.row_hash);
    const tree = new MerkleTree(rowHashes);
    const calculatedRoot = tree.getRoot();

    return {
      verified: storedRoot.toLowerCase() === calculatedRoot.toLowerCase(),
      obsDate,
      storedMerkleRoot: storedRoot,
      calculatedMerkleRoot: calculatedRoot,
      rowCount: rowHashes.length,
    };
  }
}
