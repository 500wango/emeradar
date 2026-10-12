'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';

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
  const { t } = useI18n();
  const [result, setResult] = useState<SiteCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/site-check`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.title || t('siteCheck.failed'));
      setResult(payload);
    } catch (checkError: any) {
      setResult(null);
      setError(checkError.message || t('siteCheck.failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel as="section" tone="raised" className="mt-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t('projects.siteReadiness')}</h2>
          <p className="mt-1 text-xs text-fg-subtle">{t('siteCheck.desc')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={runCheck}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? t('projects.checking') : t('projects.runSiteCheck')}
        </Button>
      </div>
      {error && (
        <p className="mt-3 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {result && (
        <dl className="mt-4 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-fg-subtle">HTTP</dt>
            <dd className="font-medium text-fg">
              {result.http.ok
                ? `OK (${result.http.status})`
                : `${t('siteCheck.httpFailed')} (${result.http.status ?? t('common.unknown')})`}
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Robots</dt>
            <dd className="font-medium text-fg">{result.robots}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Noindex</dt>
            <dd className="font-medium text-fg">
              {result.noindex === null
                ? t('common.unknown')
                : result.noindex
                ? t('siteCheck.noindexPresent')
                : t('siteCheck.noindexNotFound')}
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle">{t('siteCheck.readableContent')}</dt>
            <dd className="font-medium text-fg">
              {result.crawlableContent ? t('siteCheck.detected') : t('siteCheck.notDetected')}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-fg-subtle">Canonical</dt>
            <dd className="break-all font-medium text-fg">
              {result.canonical || t('siteCheck.canonicalNotSet')}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-fg-subtle">Sitemap</dt>
            <dd className="break-all font-medium text-fg">
              {result.sitemap.status} · {result.sitemap.url}
            </dd>
          </div>
        </dl>
      )}
    </Panel>
  );
}
