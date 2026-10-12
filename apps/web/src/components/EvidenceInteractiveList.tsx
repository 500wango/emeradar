'use client';

import React from 'react';
import { useEvidenceDrawer } from '../lib/evidence-store';
import { formatDate } from '../lib/format';
import { useI18n } from '@/lib/i18n';
import { Badge, type BadgeTone } from '@/components/ui/Badge';

interface EvidenceItem {
  id: string;
  evidence_class: string;
  source_type: string;
  source_id?: string;
  domain?: string;
  title: string;
  snippet: string;
  payload: any;
  observed_at: string | Date;
}

const evidenceClassTones: Record<string, BadgeTone> = {
  OBSERVED: 'signal',
  SELF_REPORTED: 'warn',
  THIRD_PARTY_ESTIMATE: 'info',
  INFERRED: 'info',
};

export function EvidenceInteractiveList({ evidence }: { evidence: EvidenceItem[] }) {
  const { openDrawer } = useEvidenceDrawer();
  const { t } = useI18n();

  const handleOpen = (ev: EvidenceItem) => {
    openDrawer({
      id: ev.id,
      evidenceClass: ev.evidence_class,
      sourceType: ev.source_type,
      sourceId: ev.source_id || 'src_unknown',
      domain: ev.domain,
      title: ev.title,
      snippet: ev.snippet,
      payload: ev.payload || {},
      observedAt: ev.observed_at,
    });
  };

  if (!evidence || evidence.length === 0) {
    return (
      <div className="p-4 rounded-sm bg-surface-2 border border-line text-xs text-fg-subtle text-center">
        {t('evidence.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {evidence.map((ev) => (
        <button
          type="button"
          key={ev.id}
          onClick={() => handleOpen(ev)}
          className="group block w-full p-4 rounded-sm bg-surface-2 border border-line hover:border-accent transition-colors cursor-pointer text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <div className="flex items-center justify-between text-fg-subtle mb-1.5">
            <span className="font-semibold text-fg flex items-center gap-1.5">
              <span>{ev.domain || ev.source_type}</span>
              <span className="text-[10px] font-mono text-fg-subtle">
                &bull; {formatDate(ev.observed_at)}
              </span>
            </span>
            <Badge tone={evidenceClassTones[ev.evidence_class] ?? 'neutral'}>
              {ev.evidence_class}
            </Badge>
          </div>

          <p className="font-semibold text-fg group-hover:text-accent transition-colors">{ev.title}</p>
          <p className="text-fg-muted mt-1 italic leading-relaxed line-clamp-2">
            &ldquo;{ev.snippet}&rdquo;
          </p>

          <div className="mt-2.5 pt-2 border-t border-line flex items-center justify-between text-[11px]">
            <span className="text-fg-subtle font-mono">ID: {ev.id.slice(0, 8)}...</span>
            <span className="text-accent font-semibold group-hover:underline flex items-center gap-1">
              <span>{t('evidence.inspect')}</span>
              <span>&rarr;</span>
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
