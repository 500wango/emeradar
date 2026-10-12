import { cn } from '@/lib/cn';

/**
 * Code-drawn stand-in for the 3D "radar matrix" render (a 848 KB JPEG).
 *
 * It is a legend of the banding scheme, not a reading: four segments per axis,
 * darkest last, with the observation each axis needs before it can leave
 * INSUFFICIENT (docs/16 §3.2 — axes are bands, never percentages).
 */

const BANDS = ['INSUFFICIENT', 'LOW', 'MEDIUM', 'HIGH'] as const;

const axes = [
  { id: 'd', axis: 'D', tone: 'axis-d', segments: ['bg-axis-d/5', 'bg-axis-d/20', 'bg-axis-d/45', 'bg-axis-d'] },
  { id: 'm', axis: 'M', tone: 'axis-m', segments: ['bg-axis-m/5', 'bg-axis-m/20', 'bg-axis-m/45', 'bg-axis-m'] },
  { id: 'w', axis: 'W', tone: 'axis-w', segments: ['bg-axis-w/5', 'bg-axis-w/20', 'bg-axis-w/45', 'bg-axis-w'] },
] as const;

const axisText: Record<string, string> = {
  d: 'text-axis-d',
  m: 'text-axis-m',
  w: 'text-axis-w',
};

export function AxisBands({ gates, note }: { gates: { d: string; m: string; w: string }; note: string }) {
  const gateFor: Record<string, string> = { d: gates.d, m: gates.m, w: gates.w };

  return (
    <div className="border border-line bg-surface/40 p-5 sm:p-7">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
        <span>BAND SCALE · 0–3</span>
        <span>PASS UNLESS ALL CLEAR</span>
      </div>

      <div className="mt-6 space-y-6">
        {axes.map((row) => (
          <div key={row.id}>
            <div className="flex items-center gap-3">
              <span className={cn('w-4 font-mono text-sm font-bold', axisText[row.id])}>{row.axis}</span>
              <div className="flex flex-1 gap-1">
                {row.segments.map((segment, index) => (
                  <span key={BANDS[index]} className={cn('h-2 flex-1', segment)} />
                ))}
              </div>
            </div>
            <div className="mt-3 flex gap-3">
              <span className="w-4 shrink-0" aria-hidden="true" />
              <div className="flex flex-1 gap-1">
                {BANDS.map((band) => (
                  <span
                    key={band}
                    className="flex-1 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-fg-subtle sm:tracking-[0.16em]"
                  >
                    {band}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-2 pl-7 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
              <span className="text-fg-subtle">GATE → </span>
              {gateFor[row.id]}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-fg-subtle">{note}</p>
    </div>
  );
}
