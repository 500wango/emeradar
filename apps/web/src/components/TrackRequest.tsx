'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/ui/Panel';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

export function TrackRequest() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ slug: string; isNew: boolean; verdict: string } | null>(
    null
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/v1/opportunities/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, marketCountry: 'US', language: 'en-US' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || t('trackRequest.errorStart'));
      setResult({
        slug: data.opportunity.slug,
        isNew: data.opportunity.isNew,
        verdict: data.opportunity.verdict,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel className="p-5">
      <form onSubmit={submit}>
        <h2 className="text-sm font-bold text-fg">{t('feed.trackRequestTitle')}</h2>
        <p className="mt-1 text-xs text-fg-muted leading-relaxed">{t('feed.trackRequestDesc')}</p>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <label htmlFor="track-request-query" className="sr-only">
            {t('feed.trackRequestPlaceholder')}
          </label>
          <Input
            id="track-request-query"
            name="query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            minLength={2}
            maxLength={120}
            required
            placeholder={t('feed.trackRequestPlaceholder')}
            className="flex-1"
          />
          <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
            {pending ? t('common.saving') : t('feed.trackRequestBtn')}
          </Button>
        </div>
        {result && (
          <p className="mt-3 text-xs text-fg-muted leading-relaxed" role="status" aria-live="polite">
            {result.isNew
              ? t('trackRequest.resultNew', { verdict: result.verdict })
              : t('trackRequest.resultExists')}{' '}
            <Link href={`/opportunities/${result.slug}`} className="font-semibold text-accent hover:underline">
              {t('trackRequest.viewObservation')}
            </Link>
          </p>
        )}
        {error && (
          <p className="mt-3 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Panel>
  );
}
