import { OpportunityService, TrackRecordService, type FeedCardItem } from '@emeradar/services';

/**
 * The homepage hero renders real observatory readings instead of a decorative
 * illustration (docs/15: no simulated data on public pages), so it needs the
 * ledger aggregates here.
 *
 * Every field is nullable on purpose: when the warehouse has no sample yet the
 * panel must render a dash, never an estimate.
 */
export interface LedgerSnapshot {
  /** Observation date of the newest sealed checkpoint (YYYY-MM-DD). */
  obsDate: string;
  /** Rows covered by that checkpoint. */
  records: number;
  /** Short prefix of the Merkle root, enough to look the checkpoint up. */
  root: string;
}

export interface TelemetrySnapshot {
  /** Opportunities currently under observation. */
  watchlist: number | null;
  /** Predictions past the public embargo. */
  published: number | null;
  /** Predictions with a matured outcome verdict. */
  evaluated: number | null;
  /** Matured 30-day hit rate, or null while the sample is too small. */
  hitRate: string | null;
  ledger: LedgerSnapshot | null;
  /** Published cards, newest first — feeds both the ticker and the signal board. */
  cards: FeedCardItem[];
}

const TTL_MS = 5 * 60 * 1000;

let cache: { at: number; value: TelemetrySnapshot } | null = null;

const EMPTY: TelemetrySnapshot = {
  watchlist: null,
  published: null,
  evaluated: null,
  hitRate: null,
  ledger: null,
  cards: [],
};

export async function getHomeTelemetry(): Promise<TelemetrySnapshot> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const value = await load();
  // Never memoise a total miss — that would turn a transient database blip into
  // five minutes of empty panels for everyone.
  if (value !== EMPTY) cache = { at: Date.now(), value };
  return value;
}

async function load(): Promise<TelemetrySnapshot> {
  const [feed, record] = await Promise.all([
    OpportunityService.listFeedCards({
      limit: 8,
      verdicts: ['BUILD_NOW', 'EARLY_BET'],
    }).catch(() => null),
    TrackRecordService.getPublicTrackRecord().catch(() => null),
  ]);

  if (!feed && !record) return EMPTY;

  const stats = record?.stats;
  const checkpoint = record?.checkpoints?.[0];

  return {
    watchlist: toNumber(stats?.activeWatchlistCount),
    published: toNumber(stats?.totalPredictions),
    evaluated: toNumber(stats?.evaluatedEpisodes),
    hitRate: typeof stats?.hitRate30d === 'string' ? stats.hitRate30d : null,
    ledger: checkpoint
      ? {
          obsDate: toIsoDate(checkpoint.obs_date),
          records: toNumber(checkpoint.total_records) ?? 0,
          root: String(checkpoint.merkle_root ?? '').slice(0, 10),
        }
      : null,
    cards: feed?.items ?? [],
  };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `pg` hands back a Date for `date` columns and a string for text; normalise both. */
function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}
