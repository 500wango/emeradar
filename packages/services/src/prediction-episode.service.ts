import { query } from '@emeradar/db';

/**
 * Prediction episodes and their outcome evaluation (06 §6-§8, `eval_spec = ev-1.0`).
 *
 * An episode is one published prediction: the day an opportunity first reaches
 * BUILD NOW / EARLY BET. `prediction_episodes` is what the public Track Record
 * page reads, so without a writer that page can only ever show an empty record —
 * which is exactly what the ledger is supposed to make impossible to fake.
 *
 * Two jobs live here:
 *   - `recordEpisode` runs inside the daily pipeline transaction, right after the
 *     day's verdicts are appended to the ledger.
 *   - `evaluateDueEpisodes` is the daily evaluator: it fills in the T+30/60/90
 *     outcomes for episodes whose horizon has passed.
 *
 * Evaluation is point-in-time by construction: every read is bounded by the
 * horizon date, so a later correction cannot retroactively change a past
 * outcome.
 */

/** Only these verdicts are predictions worth scoring in public. */
export const PREDICTION_VERDICTS = ['BUILD_NOW', 'EARLY_BET'] as const;
export type PredictionVerdict = (typeof PREDICTION_VERDICTS)[number];

/**
 * Just the `query` method, so the pipeline can hand over its transaction client
 * without this module depending on the pg type definitions.
 */
interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface EpisodeOutcome {
  horizonDays: number;
  clusterExpansion: boolean;
  sustainedNewQueries: boolean;
  marketFormed: boolean;
  windowClosed: boolean;
  outcome: 'HIT' | 'MISS';
  /** Observed values behind the booleans, kept for audit. */
  observed: Record<string, number | boolean | null>;
}

export class PredictionEpisodeService {
  static readonly EVAL_SPEC_VERSION = 'ev-1.0';
  static readonly HORIZONS = [30, 60, 90] as const;

  /** 06 §6: re-entering an opportunity within this window continues the same episode. */
  static readonly EPISODE_REENTRY_GRACE_DAYS = 14;

  /** 06 §7.1 `sustained_new_queries`. */
  static readonly NEW_QUERY_THRESHOLD = 10;
  /** 06 §7.1 `cluster_expansion`. */
  static readonly CLUSTER_EXPANSION_MULTIPLIER = 1.5;
  /** 06 §7.1 `window_closed`: e_specialist + e_authoritative >= 3. */
  static readonly WINDOW_CLOSE_EVIDENCE_THRESHOLD = 3;
  /** window.ts bands W below 4500 as LOW, which is the spec's "window closed". */
  static readonly W_LOW_BASIS_POINTS = 4500;

  /** A single evaluator pass is bounded so an unbounded backlog cannot stall the run. */
  static readonly MAX_EPISODES_PER_RUN = 500;

  static isPredictionVerdict(verdict: string | null | undefined): verdict is PredictionVerdict {
    return verdict === 'BUILD_NOW' || verdict === 'EARLY_BET';
  }

  /**
   * 06 §6: one prediction per episode start. A continuous stay in a prediction
   * verdict is one episode; leaving and re-entering later is a new one, unless
   * the gap is shorter than the grace window.
   */
  static shouldOpenEpisode(params: {
    verdict: string;
    previousVerdict: string | null | undefined;
    lastEpisodeStartDate: string | null;
    obsDate: string;
  }): boolean {
    if (!this.isPredictionVerdict(params.verdict)) return false;
    // Still in the same prediction as yesterday: the episode already covers it.
    if (this.isPredictionVerdict(params.previousVerdict ?? null)) return false;
    if (!params.lastEpisodeStartDate) return true;

    const daysSinceLastStart = Math.floor(
      (Date.parse(`${params.obsDate}T00:00:00Z`) -
        Date.parse(`${params.lastEpisodeStartDate}T00:00:00Z`)) /
        86_400_000
    );
    return daysSinceLastStart >= this.EPISODE_REENTRY_GRACE_DAYS;
  }

  /**
   * Opens an episode for a just-published prediction verdict, if this is a new
   * episode. Must be called with the pipeline's transaction client so the
   * episode and the verdict it anchors commit together.
   *
   * The id is derived from the verdict id, so replaying the same day is a no-op.
   */
  static async recordEpisode(
    client: Queryable,
    params: {
      opportunityId: string;
      verdictId: string;
      verdict: string;
      previousVerdict: string | null | undefined;
      obsDate: string;
    }
  ): Promise<boolean> {
    if (!this.isPredictionVerdict(params.verdict)) return false;

    const last = await client.query<{ predicted_at: string }>(
      `SELECT predicted_at::text FROM prediction_episodes
       WHERE opportunity_id = $1
       ORDER BY predicted_at DESC
       LIMIT 1`,
      [params.opportunityId]
    );

    const shouldOpen = this.shouldOpenEpisode({
      verdict: params.verdict,
      previousVerdict: params.previousVerdict,
      lastEpisodeStartDate: last.rows[0]?.predicted_at ?? null,
      obsDate: params.obsDate,
    });
    if (!shouldOpen) return false;

    const res = await client.query(
      `INSERT INTO prediction_episodes (
         id, verdict_id, opportunity_id, published_verdict, predicted_at,
         outcome_30d, outcome_60d, outcome_90d, metrics
       ) VALUES ($1, $2, $3, $4, $5, 'PENDING', 'PENDING', 'PENDING', $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        `eps_${params.verdictId}`,
        params.verdictId,
        params.opportunityId,
        params.verdict,
        params.obsDate,
        JSON.stringify({ evalSpecVersion: this.EVAL_SPEC_VERSION, openedBy: 'daily-pipeline' }),
      ]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Evaluates every episode whose T+30/60/90 horizon has passed and whose
   * outcome at that horizon is not yet recorded. Safe to run repeatedly: an
   * outcome is only ever written while it is still PENDING.
   */
  static async evaluateDueEpisodes(today = new Date().toISOString().slice(0, 10)): Promise<{
    episodes: number;
    evaluated: number;
    hits: number;
    misses: number;
  }> {
    const due = await query<{
      id: string;
      opportunity_id: string;
      predicted_at: string;
      outcome_30d: string | null;
      outcome_60d: string | null;
      outcome_90d: string | null;
      metrics: Record<string, unknown> | null;
    }>(
      // PENDING is the placeholder written when the episode opens, so it counts
      // as "not yet graded" exactly like NULL does.
      `SELECT e.id, e.opportunity_id, e.predicted_at::text,
              e.outcome_30d, e.outcome_60d, e.outcome_90d, e.metrics
       FROM prediction_episodes e
       WHERE (
           e.outcome_30d IS NULL OR e.outcome_30d = 'PENDING'
           OR e.outcome_60d IS NULL OR e.outcome_60d = 'PENDING'
           OR e.outcome_90d IS NULL OR e.outcome_90d = 'PENDING'
         )
         AND e.predicted_at + 30 <= $1::date
       ORDER BY e.predicted_at ASC
       LIMIT $2`,
      [today, this.MAX_EPISODES_PER_RUN]
    );

    let evaluated = 0;
    let hits = 0;
    let misses = 0;

    for (const episode of due.rows) {
      for (const horizon of this.HORIZONS) {
        const stored = episode[`outcome_${horizon}d` as const];
        // NULL means never evaluated; PENDING is the placeholder written at
        // open time, so both are due once the horizon has passed.
        if (stored === 'HIT' || stored === 'MISS') continue;

        const horizonDate = this.addDays(episode.predicted_at, horizon);
        if (Date.parse(`${horizonDate}T00:00:00Z`) > Date.parse(`${today}T00:00:00Z`)) continue;

        const outcome = await this.evaluateEpisodeAtHorizon(
          episode.opportunity_id,
          episode.predicted_at,
          horizonDate,
          horizon
        );

        const updated = await query(
          `UPDATE prediction_episodes
           SET outcome_${horizon}d = $2,
               evaluated_${horizon}d_at = $3::date,
               metrics = COALESCE(metrics, '{}'::jsonb) || $4::jsonb
           WHERE id = $1 AND (outcome_${horizon}d IS NULL OR outcome_${horizon}d = 'PENDING')`,
          [
            episode.id,
            outcome.outcome,
            today,
            JSON.stringify({
              evalSpecVersion: this.EVAL_SPEC_VERSION,
              [`h${horizon}`]: {
                horizonDate,
                clusterExpansion: outcome.clusterExpansion,
                sustainedNewQueries: outcome.sustainedNewQueries,
                marketFormed: outcome.marketFormed,
                windowClosed: outcome.windowClosed,
                observed: outcome.observed,
              },
            }),
          ]
        );
        if ((updated.rowCount ?? 0) === 0) continue;

        evaluated++;
        if (outcome.outcome === 'HIT') hits++;
        else misses++;
      }
    }

    return { episodes: due.rows.length, evaluated, hits, misses };
  }

  /**
   * Computes `market_formed` and `window_closed` at a horizon (06 §7.1) from
   * evidence observed no later than `horizonDate`.
   */
  static async evaluateEpisodeAtHorizon(
    opportunityId: string,
    startDate: string,
    horizonDate: string,
    horizonDays: number
  ): Promise<EpisodeOutcome> {
    const [startCount, horizonCount, newQueries, wRes, authorityCount] = await Promise.all([
      this.distinctSuggestionsAsOf(opportunityId, startDate),
      this.distinctSuggestionsAsOf(opportunityId, horizonDate),
      this.newSuggestionsBetween(opportunityId, startDate, horizonDate),
      query<{ w_basis_points: number }>(
        `SELECT w_basis_points FROM verdicts
         WHERE opportunity_id = $1 AND obs_date <= $2::date
         ORDER BY obs_date DESC LIMIT 1`,
        [opportunityId, horizonDate]
      ),
      this.authoritativeDomainCountBetween(opportunityId, startDate, horizonDate),
    ]);

    const clusterExpansion =
      startCount > 0 && horizonCount >= startCount * this.CLUSTER_EXPANSION_MULTIPLIER;
    const sustainedNewQueries = newQueries >= this.NEW_QUERY_THRESHOLD;
    const marketFormed = clusterExpansion && sustainedNewQueries;

    const wBasisPoints = wRes.rows[0]?.w_basis_points ?? null;
    const windowClosed = this.isWindowClosed(wBasisPoints, authorityCount);

    return {
      horizonDays,
      clusterExpansion,
      sustainedNewQueries,
      marketFormed,
      windowClosed,
      outcome: this.outcomeFor(marketFormed, windowClosed),
      observed: {
        suggestionsAtStart: startCount,
        suggestionsAtHorizon: horizonCount,
        newQueries,
        wBasisPoints,
        authoritativeDomains: authorityCount,
      },
    };
  }

  /**
   * 06 §7.1 `window_closed`: the W band has fallen to LOW at the horizon, or
   * enough specialist/authoritative results entered the SERP during the window.
   * The 4500 threshold is the same one window.ts uses to band W as LOW.
   */
  static isWindowClosed(wBasisPoints: number | null, authoritativeDomains: number): boolean {
    return (
      (wBasisPoints !== null && wBasisPoints < this.W_LOW_BASIS_POINTS) ||
      authoritativeDomains >= this.WINDOW_CLOSE_EVIDENCE_THRESHOLD
    );
  }

  /** The prediction was right when the market formed and the window stayed open. */
  static outcomeFor(marketFormed: boolean, windowClosed: boolean): 'HIT' | 'MISS' {
    return marketFormed && !windowClosed ? 'HIT' : 'MISS';
  }

  /** Distinct autocomplete suggestions observed up to (and including) `asOfDate`. */
  private static async distinctSuggestionsAsOf(
    opportunityId: string,
    asOfDate: string
  ): Promise<number> {
    const res = await query<{ n: number }>(
      `WITH latest AS (
         SELECT MAX(ao.observed_date) AS observed_date
         FROM opportunity_queries oq
         JOIN autocomplete_observations ao ON ao.query_id = oq.query_id
         WHERE oq.opportunity_id = $1 AND ao.observed_date <= $2::date
       )
       SELECT COUNT(DISTINCT s)::int AS n
       FROM opportunity_queries oq
       JOIN autocomplete_observations ao ON ao.query_id = oq.query_id
       JOIN latest ON latest.observed_date = ao.observed_date
       CROSS JOIN LATERAL unnest(ao.suggestions) AS s
       -- Scoped to this opportunity's queries: without it, every other
       -- opportunity observed on that date would inflate the cluster size.
       WHERE oq.opportunity_id = $1`,
      [opportunityId, asOfDate]
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  /** Suggestions first seen strictly after `startDate` and up to `endDate`. */
  private static async newSuggestionsBetween(
    opportunityId: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    const res = await query<{ n: number }>(
      `WITH baseline AS (
         SELECT DISTINCT s
         FROM opportunity_queries oq
         JOIN autocomplete_observations ao ON ao.query_id = oq.query_id
         CROSS JOIN LATERAL unnest(ao.suggestions) AS s
         WHERE oq.opportunity_id = $1 AND ao.observed_date <= $2::date
       ),
       window_suggestions AS (
         SELECT DISTINCT s
         FROM opportunity_queries oq
         JOIN autocomplete_observations ao ON ao.query_id = oq.query_id
         CROSS JOIN LATERAL unnest(ao.suggestions) AS s
         WHERE oq.opportunity_id = $1
           AND ao.observed_date > $2::date
           AND ao.observed_date <= $3::date
       )
       SELECT COUNT(*)::int AS n
       FROM window_suggestions w
       WHERE w.s NOT IN (SELECT s FROM baseline)`,
      [opportunityId, startDate, endDate]
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  /** Distinct specialist/authoritative domains ranking in the window (07 §7.1). */
  private static async authoritativeDomainCountBetween(
    opportunityId: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    const res = await query<{ n: number }>(
      `SELECT COUNT(DISTINCT r.domain)::int AS n
       FROM opportunity_queries oq
       JOIN serp_snapshots ss ON ss.query_id = oq.query_id
       JOIN serp_results r ON r.serp_snapshot_id = ss.id
       WHERE oq.opportunity_id = $1
         AND ss.obs_date > $2::date
         AND ss.obs_date <= $3::date
         AND r.domain_authority_class IN ('SPECIALIST', 'HIGH_AUTHORITY_GENERIC')`,
      [opportunityId, startDate, endDate]
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  private static addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
