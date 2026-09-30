'use client';

import { useState } from 'react';

type SiteCheckResult = {
  url: string;
  http: { ok: boolean; status?: number };
  robots: 'ALLOW' | 'DISALLOW' | 'UNKNOWN';
  noindex: boolean | null;
  canonical: string | null;
  crawlableContent: boolean;
  sitemap: { status: 'FOUND' | 'UNKNOWN' | 'FAILED'; url: string };
};

export default function SiteCheckButton({ projectId }: { projectId: string }) {
  const [result, setResult] = useState<SiteCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/site-check`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.title || 'Site check failed');
      setResult(payload);
    } catch (checkError: any) {
      setResult(null);
      setError(checkError.message || 'Site check failed');
    } finally {
      setLoading(false);
    }
  }

  return <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Site readiness</h2>
        <p className="mt-1 text-xs text-slate-500">Checks the public page and crawl signals. It does not verify Google indexing.</p>
      </div>
      <button type="button" onClick={runCheck} disabled={loading} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-wait disabled:opacity-60">
        {loading ? 'Checking...' : 'Run site check'}
      </button>
    </div>
    {error && <p className="mt-3 text-xs text-red-700" role="alert">{error}</p>}
    {result && <dl className="mt-4 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
      <div><dt className="text-slate-500">HTTP</dt><dd className="font-medium text-slate-900">{result.http.ok ? `OK (${result.http.status})` : `Failed (${result.http.status ?? 'unknown'})`}</dd></div>
      <div><dt className="text-slate-500">Robots</dt><dd className="font-medium text-slate-900">{result.robots}</dd></div>
      <div><dt className="text-slate-500">Noindex</dt><dd className="font-medium text-slate-900">{result.noindex === null ? 'Unknown' : result.noindex ? 'Present' : 'Not found'}</dd></div>
      <div><dt className="text-slate-500">Readable content</dt><dd className="font-medium text-slate-900">{result.crawlableContent ? 'Detected' : 'Not detected'}</dd></div>
      <div className="sm:col-span-2"><dt className="text-slate-500">Canonical</dt><dd className="break-all font-medium text-slate-900">{result.canonical || 'Not found'}</dd></div>
      <div className="sm:col-span-2"><dt className="text-slate-500">Sitemap</dt><dd className="break-all font-medium text-slate-900">{result.sitemap.status} · {result.sitemap.url}</dd></div>
    </dl>}
  </section>;
}
