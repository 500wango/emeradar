import { cn } from '@/lib/cn';

/**
 * A quota consumption bar: used / limit, drawn as a hairline.
 *
 * This is NOT a score bar. The distinction matters — docs/16 §3.2 bans drawing
 * the evaluation axes as percentages, and an axis bar and a quota bar look
 * identical if the quota bar is a fat rounded pill. Keeping this one a single
 * 2px rule under a mono readout makes it read as instrumentation.
 */
export function Meter({
  value,
  max,
  tone = 'accent',
  className,
}: {
  value: number;
  max: number;
  tone?: 'accent' | 'signal' | 'warn' | 'neutral';
  className?: string;
}) {
  const safeMax = Math.max(1, max);
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));

  const toneClasses = {
    accent: 'bg-accent',
    signal: 'bg-signal',
    warn: 'bg-warn',
    neutral: 'bg-fg-muted',
  } as const;

  return (
    <div className={cn('h-1 w-full overflow-hidden bg-surface-2', className)}>
      <div className={cn('h-full transition-[width]', toneClasses[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
