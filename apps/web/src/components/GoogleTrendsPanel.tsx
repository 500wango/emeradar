'use client';

import React from 'react';
import { ExternalLink, Search, Layers, Compass } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { buttonVariants } from '@/components/ui/Button';

interface GoogleTrendsPanelProps {
  query: string;
  marketCountry?: string;
  clusterQueries?: Array<{ id: string; query_text: string; tier: string }>;
}

export function GoogleTrendsPanel({
  query,
  marketCountry = 'US',
  clusterQueries = [],
}: GoogleTrendsPanelProps) {
  const { t } = useI18n();
  const geo = marketCountry || 'US';
  const trendsExploreUrl = `https://trends.google.com/trends/explore?q=${encodeURIComponent(
    query
  )}&geo=${encodeURIComponent(geo)}&date=today%2012-m`;

  return (
    <Panel className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-sm bg-accent/10 text-accent">
              <Compass className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-fg">{t('trends.title')}</h2>
          </div>
          <p className="text-xs text-fg-subtle mt-1">{t('trends.desc', { geo })}</p>
        </div>

        <a
          href={trendsExploreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'primary', size: 'sm', className: 'shrink-0' })}
        >
          <span>{t('trends.openBtn', { geo })}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-fg">
            <Search className="w-3.5 h-3.5 text-accent" />
            <span>{t('trends.queriesOnFile')}</span>
          </div>
          <span className="text-[11px] font-mono text-fg-subtle">
            {t('trends.storedCount', { count: clusterQueries.length })}
          </span>
        </div>

        {clusterQueries.length > 0 ? (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {clusterQueries.map((cq) => (
              <div
                key={cq.id}
                className="p-2.5 rounded-sm bg-surface-2 border border-line flex items-center justify-between gap-2 text-xs"
              >
                <span className="font-mono text-fg truncate text-[11px]">{cq.query_text}</span>
                <Badge tone="neutral">Tier {cq.tier}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-sm bg-surface-2 border border-line text-center text-xs text-fg-subtle">
            {t('trends.empty')}
          </div>
        )}
      </div>

      <div className="mt-4 p-3 rounded-sm bg-warn/10 border border-warn/30 text-xs text-warn flex items-start gap-2 leading-relaxed">
        <Layers className="w-4 h-4 shrink-0 mt-0.5" />
        <div>{t('trends.demandNote')}</div>
      </div>
    </Panel>
  );
}
