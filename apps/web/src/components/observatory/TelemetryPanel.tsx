import Link from 'next/link';
import { Panel } from '@/components/ui/Panel';
import { Stat } from '@/components/ui/Stat';
import { RadarSweep } from './RadarSweep';
import type { FeedCardItem } from '@emeradar/services';
import type { TelemetrySnapshot } from '@/lib/observatory/telemetry';

/**
 * The hero instrument. Every number here is read from the ledger and the
 * opportunity table on each request — nothing is illustrative, so a missing
 * sample renders as `—` rather than a plausible-looking value.
 *
 * Labels stay English mono on purpose: `uppercase` and letter-spacing are
 * no-ops on CJK, and instrument labels are part of the design language.
 */
export function TelemetryPanel({
  telemetry,
  cards,
  note,
}: {
  telemetry: TelemetrySnapshot;
  /** The cards actually on the board — the caps apply before this readout, so
      the panel never reports a BUILD NOW count the board is not showing. */
  cards: FeedCardItem[];
  note: string;
}) {
  const { watchlist, published, evaluated, hitRate, ledger } = telemetry;
  const keyCount = cards.filter((card) => card.verdict === 'BUILD_NOW').length;
  const highestConfidence = cards.some((card) => card.confidence === 'HIGH')
    ? 'HIGH'
    : cards[0]?.confidence ?? null;

  return (
    <Panel brackets className="p-6 backdrop-blur-sm sm:p-7">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
        <span>
          LIVE SIGNAL ·{' '}
          <span className="text-signal">{ledger ? `LEDGER ${ledger.obsDate}` : 'LEDGER —'}</span>
        </span>
        <span>
          SWEEP <span className="text-signal">04.5s</span>
        </span>
      </div>

      <RadarSweep className="mx-auto my-7 h-44 w-44 sm:h-52 sm:w-52" />

      <div className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-line pt-5 sm:grid-cols-4">
        <Stat size="sm" value={format(watchlist)} label="WATCHLIST" />
        <Stat size="sm" value={format(published)} label="PREDICTIONS" />
        <Stat size="sm" value={format(evaluated)} label="EVALUATED" />
        <Stat size="sm" tone={hitRate ? 'signal' : 'default'} value={hitRate ?? '—'} label="HIT RATE 30D" />
      </div>

      <Link
        href="/track-record"
        className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle transition-colors hover:text-fg-muted"
      >
        {ledger ? (
          <>
            <span>CHECKPOINT {ledger.obsDate}</span>
            <span>{ledger.records.toLocaleString('en-US')} ROWS</span>
            <span className="truncate">{ledger.root}…</span>
            <span className="text-signal">SEALED</span>
          </>
        ) : (
          <span>NO CHECKPOINT SEALED YET</span>
        )}
      </Link>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
        CONTACTS <span className="text-fg-muted">{cards.length}</span> · BUILD{' '}
        <span className={keyCount > 0 ? 'text-signal' : 'text-fg-muted'}>×{keyCount}</span>
        {highestConfidence && (
          <>
            {' '}
            · CONF <span className="text-fg-muted">{highestConfidence}</span>
          </>
        )}
      </p>

      <p className="mt-4 border-t border-line pt-4 text-[11px] leading-relaxed text-fg-subtle">{note}</p>
    </Panel>
  );
}

function format(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}
