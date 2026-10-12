import { cn } from '@/lib/cn';

/**
 * The radar dial: concentric rings, crosshair, sweeping beam and contact blips.
 *
 * Decorative only — it never carries data. The animation lives behind
 * `prefers-reduced-motion: no-preference` (globals.css), so with reduced motion
 * the dial renders as a static image of itself.
 */

export interface RadarBlip {
  /** Position as a percentage of the dial box. */
  left: string;
  top: string;
  tone?: 'signal' | 'warn';
}

const defaultBlips: RadarBlip[] = [
  { left: '64%', top: '28%' },
  { left: '36%', top: '60%' },
  { left: '71%', top: '66%', tone: 'warn' },
];

export function RadarSweep({ blips = defaultBlips, className }: { blips?: RadarBlip[]; className?: string }) {
  return (
    <div className={cn('relative', className)} aria-hidden="true">
      <div className="absolute inset-0 rounded-full border border-line-strong" />
      <div className="absolute rounded-full border border-line" style={{ inset: '22%' }} />
      <div className="absolute rounded-full border border-line" style={{ inset: '40%' }} />
      <div className="absolute left-0 right-0 top-1/2 h-px bg-line" />
      <div className="absolute bottom-0 left-1/2 top-0 w-px bg-line" />
      <div className="obs-sweep absolute inset-0 rounded-full" />
      {blips.map((blip, index) => (
        <span
          key={index}
          className={cn(
            // A blurred glow was the dark-canvas reading of a blip; on paper it
            // simply disappears. A spread-only ring gives the same "lit contact"
            // cue without depending on a dark background.
            'absolute h-1.5 w-1.5 rounded-full shadow-[0_0_0_3px]',
            blip.tone === 'warn' ? 'bg-warn shadow-warn/25' : 'bg-signal shadow-signal/25'
          )}
          style={{ left: blip.left, top: blip.top }}
        />
      ))}
    </div>
  );
}
