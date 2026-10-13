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

/** 判据来自快照，还是来自"这个 Episode 太老、没有快照"的回落。 */
export type CriteriaSource = 'snapshot' | 'active-spec-fallback';

/**
 * 一个评估规格的**全部内容**（06 §7）。
 *
 * 它是数据，不是散落的常量，因为判据必须能随预测一起被封存（06 §7「预先固定」）。
 * 常量版的判据有一个静默的失效方式：改一个数字，此后所有**尚未评估**的历史
 * Episode 都会按新判据判定，而它们的记录里仍写着原来的 `eval_spec` 版本 ——
 * 没有任何地方会报错，账本一个字都不用改，历史就被重写了。
 */
export interface EvaluationCriteria {
  /** 06 §7 的 `eval_spec` 版本，如 `ev-1.0`。 */
  criteriaVersion: string;
  horizons: readonly number[];
  /** 被判定的目标事件（06 §7.1）。 */
  target: 'market_formed';
  thresholds: {
    /** 06 §7.1 `sustained_new_queries`：窗口内新增簇 query 的下限。 */
    newQueries: number;
    /** 06 §7.1 `cluster_expansion`：末端簇规模相对预测日的倍数下限。 */
    clusterExpansionMultiplier: number;
    /** W 档低于此值即 `LOW`；与 window.ts 的分档阈值同一个数。 */
    wLowBasisPoints: number;
    /** 06 §7.1 `window_closed`：窗口内 specialist + authoritative 域名数下限。 */
    windowCloseEvidence: number;
  };
}

/**
 * 当前生效的评估规格（`ev-1.0`）。
 *
 * 改这里的任何一个数字都等于定义一个新规格：必须同时改 `criteriaVersion`
 * （06 §7「变更即新版本，历史评估保留」），否则已经写进账本的旧预测会声称
 * 自己是按新判据判的。
 */
export const ACTIVE_EVAL_CRITERIA: EvaluationCriteria = {
  criteriaVersion: 'ev-1.0',
  horizons: [30, 60, 90],
  target: 'market_formed',
  thresholds: {
    newQueries: 10,
    clusterExpansionMultiplier: 1.5,
    wLowBasisPoints: 4500,
    windowCloseEvidence: 3,
  },
};

export class PredictionEpisodeService {
  static readonly EVAL_SPEC_VERSION = ACTIVE_EVAL_CRITERIA.criteriaVersion;

  /** 结果列是固定的三档（`outcome_30d/60d/90d`），判据里的地平线只能从中取。 */
  static readonly HORIZONS = [30, 60, 90] as const;

  /** 06 §6: re-entering an opportunity within this window continues the same episode. */
  static readonly EPISODE_REENTRY_GRACE_DAYS = 14;

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
   *
   * 判据快照在这里落库（06 §7「在观测结果前写定」）：写的是**当下**生效的规格，
   * 而不是评估时再读常量。评估器只认这一份快照，因此此后修改判据不会回头改动
   * 这条预测的成败口径。
   */
  static async recordEpisode(
    client: Queryable,
    params: {
      opportunityId: string;
      verdictId: string;
      verdict: string;
      previousVerdict: string | null | undefined;
      obsDate: string;
      /** 省略时取当前生效规格；显式传入只用于测试。 */
      criteria?: EvaluationCriteria;
    }
  ): Promise<boolean> {
    if (!this.isPredictionVerdict(params.verdict)) return false;
    const criteria = params.criteria ?? ACTIVE_EVAL_CRITERIA;

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
         outcome_30d, outcome_60d, outcome_90d, metrics,
         criteria_version, criteria_snapshot
       ) VALUES ($1, $2, $3, $4, $5, 'PENDING', 'PENDING', 'PENDING', $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        `eps_${params.verdictId}`,
        params.verdictId,
        params.opportunityId,
        params.verdict,
        params.obsDate,
        JSON.stringify({ evalSpecVersion: criteria.criteriaVersion, openedBy: 'daily-pipeline' }),
        criteria.criteriaVersion,
        JSON.stringify(criteria),
      ]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Evaluates every episode whose T+30/60/90 horizon has passed and whose
   * outcome at that horizon is not yet recorded. Safe to run repeatedly: an
   * outcome is only ever written while it is still PENDING.
   *
   * 判据逐 Episode 取自它自己的快照。快照缺失（本功能上线前开的 Episode）时回落到
   * 当前生效规格，并把 `criteriaSource` 一并写进指标 —— 否则事后无法区分"按它被
   * 预测时的判据判的"和"按今天的判据补判的"，两者混在一张表里就是又一次静默改写。
   */
  static async evaluateDueEpisodes(
    today = new Date().toISOString().slice(0, 10),
    fallbackCriteria: EvaluationCriteria = ACTIVE_EVAL_CRITERIA
  ): Promise<{
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
      criteria_snapshot: EvaluationCriteria | null;
    }>(
      // PENDING is the placeholder written when the episode opens, so it counts
      // as "not yet graded" exactly like NULL does.
      `SELECT e.id, e.opportunity_id, e.predicted_at::text,
              e.outcome_30d, e.outcome_60d, e.outcome_90d, e.metrics,
              e.criteria_snapshot
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
      const snapshot = episode.criteria_snapshot;
      const criteriaSource: CriteriaSource = snapshot ? 'snapshot' : 'active-spec-fallback';
      const criteria = snapshot ?? fallbackCriteria;
      // 结果列是固定三档，所以只评估二者交集里的地平线：一个只声明了 h=60 的
      // 规格不该去写 outcome_30d/90d 两列。
      const horizons = this.HORIZONS.filter((h) => criteria.horizons.includes(h));

      for (const horizon of horizons) {
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
          horizon,
          criteria
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
              evalSpecVersion: criteria.criteriaVersion,
              criteriaSource,
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
   *
   * 判据必须由调用方给出（默认当前生效规格，仅为便利）：函数体内**不得**再读
   * 类上的常量，否则快照就白存了 —— 判定仍会跟着常量漂移。
   */
  static async evaluateEpisodeAtHorizon(
    opportunityId: string,
    startDate: string,
    horizonDate: string,
    horizonDays: number,
    criteria: EvaluationCriteria = ACTIVE_EVAL_CRITERIA
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
      startCount > 0 && horizonCount >= startCount * criteria.thresholds.clusterExpansionMultiplier;
    const sustainedNewQueries = newQueries >= criteria.thresholds.newQueries;
    const marketFormed = clusterExpansion && sustainedNewQueries;

    const wBasisPoints = wRes.rows[0]?.w_basis_points ?? null;
    const windowClosed = this.isWindowClosed(wBasisPoints, authorityCount, criteria);

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
  static isWindowClosed(
    wBasisPoints: number | null,
    authoritativeDomains: number,
    criteria: EvaluationCriteria = ACTIVE_EVAL_CRITERIA
  ): boolean {
    return (
      (wBasisPoints !== null && wBasisPoints < criteria.thresholds.wLowBasisPoints) ||
      authoritativeDomains >= criteria.thresholds.windowCloseEvidence
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
