import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Eyebrow + title + lede, the trio that was re-typed identically in every
 * section of every marketing page.
 *
 * The eyebrow carries the `//` marker as a design signature; it is mono and
 * uppercase, so it should hold a Latin token rather than Chinese copy.
 */

export interface SectionHeadingProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'left' | 'center';
  as?: ElementType;
  className?: string;
  children?: ReactNode;
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = 'left',
  as: Tag = 'h2',
  className,
  children,
}: SectionHeadingProps) {
  const centered = align === 'center';

  return (
    <div className={cn(centered ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl', className)}>
      {eyebrow && (
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">
          <span className="text-fg-subtle">// </span>
          {eyebrow}
        </div>
      )}
      <Tag className="mt-3 font-display text-3xl font-bold leading-tight tracking-tight text-fg sm:text-4xl sm:leading-tight">
        {title}
      </Tag>
      {lede && <p className="mt-3 text-sm leading-relaxed text-fg-muted sm:text-base sm:leading-relaxed">{lede}</p>}
      {children}
    </div>
  );
}
