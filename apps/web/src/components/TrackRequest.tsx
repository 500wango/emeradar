'use client';

import { useState } from 'react';
import Link from 'next/link';

export function TrackRequest() {
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
      if (!res.ok) throw new Error(data.detail || 'Could not start tracking.');
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
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-bold text-slate-900">Request tracking</h2>
      <p className="mt-1 text-xs text-slate-500 leading-relaxed">
        Add a US English query to the observation pool. The first sighting is not a verdict.
        BUILD NOW requires 14 days of autocomplete history and one organic SERP snapshot.
      </p>
      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          minLength={2}
          required
          placeholder="invoice generator"
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Start tracking'}
        </button>
      </div>
      {result && (
        <p className="mt-3 text-xs text-slate-700 leading-relaxed">
          {result.isNew
            ? `Observation started. Published verdict: ${result.verdict}. It stays out of today's decision feed until the history is long enough.`
            : 'This query is already on file.'}{' '}
          <Link href={`/opportunities/${result.slug}`} className="font-semibold text-blue-700 hover:underline">
            View observation
          </Link>
        </p>
      )}
      {error && <p className="mt-3 text-xs text-rose-700">{error}</p>}
    </form>
  );
}
