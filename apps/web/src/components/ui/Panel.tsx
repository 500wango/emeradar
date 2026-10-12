import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The single card/panel shell. Replaces the ~86 hand-written combinations of
 * `rounded-* border border-slate-200 bg-white` scattered across pages.
 *
 * `brackets` draws the viewfinder corner marks, which are always on now that
 * the site is single-theme — `--obs-bracket-len` carries a real value at
 * `:root`.
 */

export type PanelTone = 'default' | 'raised' | 'sunken' | 'inverse';

const toneClasses: Record<PanelTone, string> = {
  default: 'bg-surface border border-line',
  raised: 'bg-surface-2 border border-line',
  sunken: 'bg-canvas border border-line',
  // `on-inverse` re-points the signal tokens at their on-dark values for the
  // whole subtree — see globals.css. Without it, `text-warn` inside this panel
  // is a dark ink on a dark well.
  inverse: 'on-inverse bg-inverse text-inverse-fg border border-inverse-line',
};

export interface PanelProps {
  tone?: PanelTone;
  brackets?: boolean;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
}

export function Panel({
  tone = 'default',
  brackets = false,
  as: Tag = 'div',
  className,
  children,
}: PanelProps) {
  return (
    <Tag className={cn('relative', toneClasses[tone], brackets && 'obs-frame', className)}>
      {children}
    </Tag>
  );
}
