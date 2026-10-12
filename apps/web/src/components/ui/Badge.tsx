import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Consolidates the 94 hand-written `rounded-full` pills, which were the same
 * two class strings with the colour swapped in each place.
 *
 * Labels are mono + uppercase by construction. Note that `uppercase` and
 * letter-spacing are no-ops on CJK, so anything passed as a badge label must be
 * the English token itself (`BUILD NOW`, `DEMAND`, `HIGH`) — Chinese belongs in
 * the surrounding copy, not inside a badge.
 */

export type BadgeTone = 'neutral' | 'signal' | 'warn' | 'danger' | 'info' | 'accent';
export type BadgeSize = 'xs' | 'sm';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border-line text-fg-muted bg-surface-2',
  signal: 'border-signal/40 text-signal bg-signal/10',
  warn: 'border-warn/40 text-warn bg-warn/10',
  danger: 'border-danger/40 text-danger bg-danger/10',
  info: 'border-info/40 text-info bg-info/10',
  accent: 'border-accent/40 text-accent bg-accent/10',
};

const sizeClasses: Record<BadgeSize, string> = {
  xs: 'text-[10px] px-2 py-0.5 gap-1.5',
  sm: 'text-[11px] px-2.5 py-1 gap-1.5',
};

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Badge({ tone = 'neutral', size = 'xs', dot = false, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border font-mono font-medium uppercase tracking-[0.14em] whitespace-nowrap',
        sizeClasses[size],
        toneClasses[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/* ── Verdicts ─────────────────────────────────────────────────────────────
   Colour follows the rest of the product's semantics (emerald = go,
   amber = watch, rose = risk) so the mental model carries over from the feed. */

export type Verdict = 'BUILD_NOW' | 'EARLY_BET' | 'WATCH_CHANGES' | 'WINDOW_CLOSING' | 'WATCH' | 'PASS';

const verdictTones: Record<Verdict, BadgeTone> = {
  BUILD_NOW: 'signal',
  EARLY_BET: 'info',
  WATCH_CHANGES: 'warn',
  WATCH: 'warn',
  WINDOW_CLOSING: 'danger',
  PASS: 'neutral',
};

export function VerdictBadge({
  verdict,
  size = 'xs',
  className,
}: {
  verdict: Verdict;
  size?: BadgeSize;
  className?: string;
}) {
  return (
    <Badge tone={verdictTones[verdict] ?? 'neutral'} size={size} dot className={className}>
      {verdict.replace(/_/g, ' ')}
    </Badge>
  );
}

/* ── The three evaluation axes ────────────────────────────────────────────
   PRD §5 / docs/16 §3.2: the axes are shown as bands, never as a percentage or
   a composite score. Each axis keeps its own colour — one shared colour would
   make the D/M/W readout unscannable. */

export type Axis = 'd' | 'm' | 'w';
export type Band = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

const axisClasses: Record<Axis, string> = {
  d: 'border-axis-d/40 text-axis-d bg-axis-d/10',
  m: 'border-axis-m/40 text-axis-m bg-axis-m/10',
  w: 'border-axis-w/40 text-axis-w bg-axis-w/10',
};

export function AxisBadge({
  axis,
  band,
  size = 'xs',
  className,
}: {
  axis: Axis;
  band: Band | string;
  size?: BadgeSize;
  className?: string;
}) {
  const resolved = String(band).toUpperCase();
  const muted = resolved === 'LOW' || resolved === 'INSUFFICIENT';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border font-mono font-medium uppercase tracking-[0.14em] whitespace-nowrap',
        sizeClasses[size],
        muted ? toneClasses.neutral : axisClasses[axis],
        className
      )}
      title={resolved === 'INSUFFICIENT' ? '数据不足' : undefined}
    >
      <span className="font-bold">{axis.toUpperCase()}</span>
      {/* Both halves sit at full opacity. Fading the band word by 20% is the
          obvious way to make the letter dominate, but on paper it drops the
          label under 4.5:1 over the badge's own tint (Lighthouse flags every
          D/M/W chip on the homepage). Weight alone carries the hierarchy. */}
      <span className="font-normal">{resolved}</span>
    </span>
  );
}
