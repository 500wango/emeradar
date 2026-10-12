import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Logo } from '@/components/Logo';
import { Panel } from './Panel';

/**
 * Shared frame for the five credential pages (sign in, sign up, forgot, reset,
 * verify). Each one previously repeated the same gradient background, the same
 * centred heading block and the same card, with the slate/blue palette written
 * out inline every time.
 */
export function AuthShell({
  title,
  desc,
  width = 'md',
  children,
  footnote,
}: {
  title: ReactNode;
  desc?: ReactNode;
  width?: 'md' | 'lg';
  children: ReactNode;
  /** Muted line under the card — security notes, disclaimers. */
  footnote?: ReactNode;
}) {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-col justify-center px-4 py-16">
      <div className="mx-auto w-full max-w-md text-center">
        <Link href="/" className="inline-block">
          <Logo variant="header" className="mx-auto h-9 w-auto" idPrefix="auth" />
        </Link>
        <h1 className="mt-8 font-display text-2xl font-extrabold tracking-tight text-fg sm:text-3xl">
          {title}
        </h1>
        {desc && <p className="mt-3 text-sm leading-relaxed text-fg-muted">{desc}</p>}
      </div>

      <Panel
        brackets
        className={cn('mx-auto mt-10 w-full p-6 sm:p-9', width === 'lg' ? 'max-w-lg' : 'max-w-md')}
      >
        {children}
      </Panel>

      {footnote && (
        /* Deliberately not uppercase: the same slot carries short instrument
           labels and full sentences ("the same result is shown whether or not
           that address exists"), and uppercase only works for the former. */
        <p className="mx-auto mt-7 flex max-w-md flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center font-mono text-[11px] leading-relaxed text-fg-subtle">
          {footnote}
        </p>
      )}
    </main>
  );
}

/** Inline form error. Used on all five pages, so it lives with the shell. */
export function AuthError({ title, message }: { title?: ReactNode; message: ReactNode }) {
  return (
    <div role="alert" className="mb-6 border-l-2 border-danger bg-danger/5 py-3 pl-4">
      {title && <p className="text-xs font-semibold text-danger">{title}</p>}
      <p className="text-xs leading-relaxed text-fg-muted">{message}</p>
    </div>
  );
}
