import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { SectionHeading } from './SectionHeading';

/**
 * The outer frame every page shares: one max-width, one gutter, one vertical
 * rhythm. Previously each page invented its own (`max-w-7xl … py-12` on the
 * track record, `max-w-3xl … py-14` on methodology), so nothing lined up when
 * you navigated between them.
 */

export type PageWidth = 'prose' | 'wide' | 'full';

const widthClasses: Record<PageWidth, string> = {
  prose: 'max-w-3xl',
  wide: 'max-w-6xl',
  full: 'max-w-7xl',
};

export function PageFrame({
  width = 'wide',
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('mx-auto px-4 py-14 sm:px-6 sm:py-16 lg:px-8', widthClasses[width], className)}>
      {children}
    </div>
  );
}

/**
 * Page title block. The `h1` matters: `SectionHeading` renders `h2` by default,
 * and every one of these pages was previously hand-rolling the same eyebrow /
 * title / lede trio with a different type scale.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  aside,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  /** Rendered to the right of the title on wide screens — status pills, badges. */
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'border-b border-line pb-8',
        aside && 'flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between',
        className
      )}
    >
      <SectionHeading as="h1" eyebrow={eyebrow} title={title} lede={lede} />
      {aside && <div className="shrink-0">{aside}</div>}
    </header>
  );
}
