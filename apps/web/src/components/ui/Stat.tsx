import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A single instrument readout: tabular mono value over a mono uppercase label.
 * Replaces the four copy-pasted statistic cards on the landing page.
 */

export type StatTone = 'default' | 'accent' | 'signal' | 'warn';
export type StatSize = 'sm' | 'md' | 'lg';

const toneClasses: Record<StatTone, string> = {
  default: 'text-fg',
  accent: 'text-accent',
  signal: 'text-signal',
  warn: 'text-warn',
};

const valueSizeClasses: Record<StatSize, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
};

export interface StatProps {
  value: ReactNode;
  label: ReactNode;
  unit?: string;
  tone?: StatTone;
  size?: StatSize;
  className?: string;
}

export function Stat({ value, label, unit, tone = 'default', size = 'md', className }: StatProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className={cn('font-mono font-bold tabular-nums', valueSizeClasses[size], toneClasses[tone])}>
        {value}
        {unit && <span className="ml-0.5 text-[0.6em] font-medium">{unit}</span>}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">{label}</div>
    </div>
  );
}
