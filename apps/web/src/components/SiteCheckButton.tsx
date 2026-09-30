'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';

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
  const { t, isZh } = useI18n();
  const [result, setResult] = useState<SiteCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/site-check`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.title || (isZh ? '站点就绪度检查失败' : 'Site check failed'));
      setResult(payload);
    } catch (checkError: any) {
      setResult(null);
      setError(checkError.message || (isZh ? '站点就绪度检查失败' : 'Site check failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{t('projects.siteReadiness')}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {isZh
              ? '检查公开网页状态与抓取信号，并不验证 Google 真实收录索引。'
              : 'Checks the public page and crawl signals. It does not verify Google indexing.'}
          </p>
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={loading}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? t('projects.checking') : t('projects.runSiteCheck')}
        </button>
      </div>
      {error && <p className="mt-3 text-xs text-red-700" role="alert">{error}</p>}
      {result && (
        <dl className="mt-4 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">HTTP</dt>
            <dd className="font-medium text-slate-900">
              {result.http.ok ? `OK (${result.http.status})` : `${isZh ? '失败' : 'Failed'} (${result.http.status ?? 'unknown'})`}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Robots</dt>
            <dd className="font-medium text-slate-900">{result.robots}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Noindex</dt>
            <dd className="font-medium text-slate-900">
              {result.noindex === null ? (isZh ? '未知' : 'Unknown') : result.noindex ? (isZh ? '存在' : 'Present') : (isZh ? '未发现' : 'Not found')}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{isZh ? '可读内容' : 'Readable content'}</dt>
            <dd className="font-medium text-slate-900">
              {result.crawlableContent ? (isZh ? '已检测到' : 'Detected') : (isZh ? '未检测到' : 'Not detected')}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Canonical</dt>
            <dd className="break-all font-medium text-slate-900">{result.canonical || (isZh ? '未设置' : 'Not found')}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Sitemap</dt>
            <dd className="break-all font-medium text-slate-900">{result.sitemap.status} · {result.sitemap.url}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
