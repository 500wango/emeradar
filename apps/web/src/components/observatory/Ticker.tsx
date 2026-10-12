import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Scrolling strip of live signal readings.
 *
 * The track holds exactly two copies of the item list and travels -50%, which
 * is what makes the loop seamless; the second copy is hidden from assistive
 * tech. With reduced motion the animation is dropped and the first items simply
 * stay put, so the strip still reads as a static list.
 */

export interface TickerProps {
  items: ReactNode[];
  className?: string;
}

export function Ticker({ items, className }: TickerProps) {
  return (
    <div className={cn('overflow-hidden border-y border-line bg-surface/40 py-3', className)}>
      <div className="obs-tick-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 gap-14 pr-14" aria-hidden={copy === 1}>
            {items.map((item, index) => (
              <span
                key={index}
                className="font-mono text-[11px] tracking-[0.08em] whitespace-nowrap text-fg-subtle"
              >
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
