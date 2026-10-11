import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { query, transaction, closePool } from '@emeradar/db';
import { PredictionEpisodeService } from '../src';

/**
 * Prediction episodes are the public Track Record's only data source, and the
 * horizon evaluation is the one place where the product grades its own past
 * calls. These tests pin the shape of that grading.
 *
 * The suite deliberately never writes to `verdicts`: that table is append-only
 * (a delete trigger rejects the whole statement, cascades included), so a
 * fixture row could never be cleaned up.
 */
describe('PredictionEpisodeService', () => {
  const opportunityId = 'opp_episode_test';
  const queryId = 'qry_episode_test';
  const today = new Date().toISOString().slice(0, 10);
  const start = '2026-01-01';

  const idFor = (prefix: string) => `${prefix}_${opportunityId}`;

  /**
   * `prediction_episodes.verdict_id` is a foreign key into the append-only
   * `verdicts` table, so the fixture borrows an existing ledger row instead of
   * inserting (and never being able to delete) one of its own.
   */
  async function borrowVerdictId(): Promise<string | null> {
    const res = await query<{ id: string }>(`SELECT id FROM verdicts ORDER BY obs_date DESC LIMIT 1`);
    return res.rows[0]?.id ?? null;
  }

  async function resetFixture() {
    await query(`DELETE FROM prediction_episodes WHERE opportunity_id = $1`, [opportunityId]);
    await query(`DELETE FROM autocomplete_observations WHERE query_id = $1`, [queryId]);
    await query(`DELETE FROM opportunity_queries WHERE opportunity_id = $1`, [opportunityId]);
    await query(`DELETE FROM queries WHERE id = $1`, [queryId]);
    await query(`DELETE FROM opportunities WHERE id = $1`, [opportunityId]);
  }

  before(async () => {
    await resetFixture();
    await query(
      `INSERT INTO opportunities (id, slug, title, status, first_observed_date)
       VALUES ($1, 'episode-test', 'Episode Test', 'TRACKED', $2::date)`,
      [opportunityId, start]
    );
    await query(
      `INSERT INTO queries (id, query_text) VALUES ($1, 'episode test query')`,
      [queryId]
    );
    await query(
      `INSERT INTO opportunity_queries (opportunity_id, query_id, role) VALUES ($1, $2, 'PRIMARY')`,
      [opportunityId, queryId]
    );
  });

  after(async () => {
    await resetFixture();
    await closePool();
  });

  it('opens an episode only on a fresh prediction verdict', () => {
    const base = { previousVerdict: 'WATCH', lastEpisodeStartDate: null, obsDate: start };
    assert.strictEqual(
      PredictionEpisodeService.shouldOpenEpisode({ ...base, verdict: 'BUILD_NOW' }),
      true
    );
    assert.strictEqual(
      PredictionEpisodeService.shouldOpenEpisode({ ...base, verdict: 'EARLY_BET' }),
      true
    );
    // WATCH / WINDOW_CLOSING / PASS are not predictions.
    assert.strictEqual(
      PredictionEpisodeService.shouldOpenEpisode({ ...base, verdict: 'WATCH' }),
      false
    );
  });

  it('keeps one episode while the verdict stays a prediction', () => {
    assert.strictEqual(
      PredictionEpisodeService.shouldOpenEpisode({
        verdict: 'BUILD_NOW',
        previousVerdict: 'BUILD_NOW',
        lastEpisodeStartDate: '2026-01-01',
        obsDate: '2026-01-02',
      }),
      false
    );
  });

  it('treats a re-entry inside the grace window as the same episode', () => {
    assert.strictEqual(
      PredictionEpisodeService.shouldOpenEpisode({
        verdict: 'BUILD_NOW',
        previousVerdict: 'WATCH',
        lastEpisodeStartDate: '2026-01-01',
        obsDate: '2026-01-10', // 9 days later, inside the 14-day grace
      }),
      false
    );
    assert.strictEqual(
      PredictionEpisodeService.shouldOpenEpisode({
        verdict: 'BUILD_NOW',
        previousVerdict: 'WATCH',
        lastEpisodeStartDate: '2026-01-01',
        obsDate: '2026-02-15', // 45 days later: a new episode
      }),
      true
    );
  });

  it('closes a window on a LOW W band or three authoritative entrants', () => {
    assert.strictEqual(PredictionEpisodeService.isWindowClosed(null, 0), false);
    assert.strictEqual(PredictionEpisodeService.isWindowClosed(7000, 2), false);
    assert.strictEqual(PredictionEpisodeService.isWindowClosed(4499, 0), true);
    assert.strictEqual(PredictionEpisodeService.isWindowClosed(4500, 0), false);
    assert.strictEqual(PredictionEpisodeService.isWindowClosed(9000, 3), true);
  });

  it('scores a hit only when the market formed and the window stayed open', () => {
    assert.strictEqual(PredictionEpisodeService.outcomeFor(true, false), 'HIT');
    assert.strictEqual(PredictionEpisodeService.outcomeFor(true, true), 'MISS');
    assert.strictEqual(PredictionEpisodeService.outcomeFor(false, false), 'MISS');
  });

  it('grades a formed market with an open window as a hit', async () => {
    await query(
      `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions)
       VALUES ($1, $2::date, $3)`,
      [queryId, start, ['a', 'b', 'c', 'd']]
    );
    // Four baseline suggestions become sixteen by the horizon: 16 >= 4 * 1.5
    // (cluster expansion), and twelve of them are new (>= the 10 the spec asks
    // for as "sustained new queries").
    await query(
      `INSERT INTO autocomplete_observations (query_id, observed_date, suggestions)
       VALUES ($1, $2::date, $3)`,
      [
        queryId,
        '2026-01-31',
        [
          'a', 'b', 'c', 'd',
          'e', 'f', 'g', 'h',
          'i', 'j', 'k', 'l',
          'm', 'n', 'o', 'p',
        ],
      ]
    );

    const result = await PredictionEpisodeService.evaluateEpisodeAtHorizon(
      opportunityId,
      start,
      '2026-01-31',
      30
    );
    assert.strictEqual(result.clusterExpansion, true);
    assert.strictEqual(result.sustainedNewQueries, true);
    assert.strictEqual(result.marketFormed, true);
    assert.strictEqual(result.windowClosed, false);
    assert.strictEqual(result.outcome, 'HIT');
  });

  it('opens an episode from inside the pipeline transaction, once', async (t) => {
    const verdictId = await borrowVerdictId();
    if (!verdictId) {
      t.skip('no verdict row available to satisfy the prediction_episodes foreign key');
      return;
    }

    const params = {
      opportunityId,
      verdictId,
      verdict: 'BUILD_NOW',
      previousVerdict: 'WATCH',
      obsDate: start,
    };

    const first = await transaction((client) => PredictionEpisodeService.recordEpisode(client, params));
    assert.strictEqual(first, true, 'a fresh prediction verdict opens an episode');

    // Replaying the same day's pipeline must not open a second episode.
    const replay = await transaction((client) => PredictionEpisodeService.recordEpisode(client, params));
    assert.strictEqual(replay, false);

    const rows = await query<{ n: string; published_verdict: string; predicted_at: string }>(
      `SELECT COUNT(*) OVER ()::text AS n, published_verdict, predicted_at::text
       FROM prediction_episodes WHERE opportunity_id = $1`,
      [opportunityId]
    );
    assert.strictEqual(Number(rows.rows[0].n), 1);
    assert.strictEqual(rows.rows[0].published_verdict, 'BUILD_NOW');
    assert.strictEqual(rows.rows[0].predicted_at, start);

    // A verdict that is not a prediction never opens one.
    const notAPrediction = await transaction((client) =>
      PredictionEpisodeService.recordEpisode(client, { ...params, verdict: 'WATCH' })
    );
    assert.strictEqual(notAPrediction, false);

    await query(`DELETE FROM prediction_episodes WHERE opportunity_id = $1`, [opportunityId]);
  });

  it('records the outcome once and never re-grades it', async (t) => {
    const verdictId = await borrowVerdictId();
    if (!verdictId) {
      t.skip('no verdict row available to satisfy the prediction_episodes foreign key');
      return;
    }

    await query(
      `INSERT INTO prediction_episodes (
         id, verdict_id, opportunity_id, published_verdict, predicted_at,
         outcome_30d, outcome_60d, outcome_90d, metrics
       ) VALUES ($1, $2, $3, 'BUILD_NOW', $4::date, 'PENDING', 'PENDING', 'PENDING', '{}')`,
      [idFor('eps'), verdictId, opportunityId, start]
    );

    const first = await PredictionEpisodeService.evaluateDueEpisodes(today);
    assert.ok(first.evaluated >= 1);

    const row = await query<{ outcome_30d: string; evaluated_30d_at: string | null; metrics: any }>(
      `SELECT outcome_30d, evaluated_30d_at::text, metrics FROM prediction_episodes WHERE id = $1`,
      [idFor('eps')]
    );
    assert.strictEqual(row.rows[0].outcome_30d, 'HIT');
    assert.strictEqual(row.rows[0].evaluated_30d_at, today);
    assert.strictEqual(row.rows[0].metrics.evalSpecVersion, PredictionEpisodeService.EVAL_SPEC_VERSION);
    assert.strictEqual(row.rows[0].metrics.h30.marketFormed, true);
    assert.strictEqual(row.rows[0].metrics.h30.windowClosed, false);
    assert.strictEqual(row.rows[0].metrics.h30.observed.newQueries, 12);

    // A second pass has nothing left to grade at T+30.
    const second = await PredictionEpisodeService.evaluateDueEpisodes(today);
    assert.strictEqual(second.evaluated, 0);
  });

  it('leaves horizons that have not matured alone', async (t) => {
    const verdictId = await borrowVerdictId();
    if (!verdictId) {
      t.skip('no verdict row available to satisfy the prediction_episodes foreign key');
      return;
    }

    await query(
      `INSERT INTO prediction_episodes (
         id, verdict_id, opportunity_id, published_verdict, predicted_at,
         outcome_30d, outcome_60d, outcome_90d, metrics
       ) VALUES ($1, $2, $3, 'EARLY_BET', $4::date, 'PENDING', 'PENDING', 'PENDING', '{}')`,
      // Predicted 20 days ago: T+30 has not arrived yet.
      [
        idFor('eps_recent'),
        verdictId,
        opportunityId,
        new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10),
      ]
    );

    const result = await PredictionEpisodeService.evaluateDueEpisodes(today);
    assert.strictEqual(result.evaluated, 0);

    const row = await query<{ outcome_30d: string }>(
      `SELECT outcome_30d FROM prediction_episodes WHERE id = $1`,
      [idFor('eps_recent')]
    );
    assert.strictEqual(row.rows[0].outcome_30d, 'PENDING');

    await query(`DELETE FROM prediction_episodes WHERE id = $1`, [idFor('eps_recent')]);
  });
});
