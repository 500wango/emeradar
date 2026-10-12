'use client';

import React from 'react';
import { CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';

interface CommercialProofPanelProps {
  stage?: string;
  gateways?: string[];
  plansCount?: number;
}

export function CommercialProofPanel({
  stage = 'NONE',
  gateways = [],
  plansCount = 0,
}: CommercialProofPanelProps) {
  const { t } = useI18n();
  const observedCommercial = plansCount > 0 || gateways.length > 0;

  // A conflict is not stored as its own flag; it is read off two fields that
  // must agree. Either the stage claims pricing/checkout the observations do
  // not contain, or the observations contain pricing the stage denies. We only
  // surface the warning when those two stored values genuinely disagree — we
  // never invent a conflict.
  const claimsPaid =
    stage === 'PRICED' || stage === 'PAID_PERSISTENT' || stage === 'REVENUE_EVIDENCED';
  const stageDeniesPricing = stage === 'NONE' || stage === 'INTENT_ONLY';
  const hasConflict =
    (observedCommercial && stageDeniesPricing) || (claimsPaid && !observedCommercial);

  return (
    <Panel className="p-6">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
        <div>
          <h2 className="text-base font-bold text-fg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-info" />
            <span>{t('commercialProof.title')}</span>
          </h2>
          <p className="text-xs text-fg-subtle mt-0.5">{t('commercialProof.subtitle')}</p>
        </div>
        <Badge tone="info" size="sm">
          {t('commercialProof.stageLabel')} · {stage}
        </Badge>
      </div>

      {hasConflict && (
        <div
          className="mb-4 flex items-start gap-2 rounded-sm border border-warn/50 bg-warn/10 p-4 text-xs leading-relaxed text-warn"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong className="block font-bold">{t('commercialProof.conflictTitle')}</strong>
            {t('commercialProof.conflictBody', { stage })}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Left Panel: What This Proves */}
        <div className="p-4 rounded-sm bg-signal/10 border border-signal/30">
          <div className="flex items-center gap-2 text-signal font-bold text-xs mb-2.5">
            <CheckCircle2 className="w-4 h-4" />
            <span>{t('commercialProof.provesTitle')}</span>
          </div>
          <ul className="space-y-2 text-xs text-fg-muted">
            {observedCommercial ? (
              <>
                {plansCount > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="text-signal font-bold">•</span>
                    <span>{t('commercialProof.plansObserved', { count: plansCount })}</span>
                  </li>
                )}
                {gateways.length > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="text-signal font-bold">•</span>
                    <span>
                      {t('commercialProof.gatewaysObserved', { gateways: gateways.join(', ') })}
                    </span>
                  </li>
                )}
              </>
            ) : (
              <li className="flex items-start gap-2">
                <span className="text-signal font-bold">•</span>
                <span>{t('commercialProof.nothingObserved', { stage })}</span>
              </li>
            )}
          </ul>
        </div>

        {/* Right Panel: What This Does NOT Prove */}
        <div className="p-4 rounded-sm bg-warn/10 border border-warn/30">
          <div className="flex items-center gap-2 text-warn font-bold text-xs mb-2.5">
            <AlertTriangle className="w-4 h-4" />
            <span>{t('commercialProof.notProvesTitle')}</span>
          </div>
          <ul className="space-y-2 text-xs text-fg-muted">
            <li className="flex items-start gap-2">
              <span className="text-warn font-bold">•</span>
              <span>{t('commercialProof.notProvesRevenue')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-warn font-bold">•</span>
              <span>{t('commercialProof.notProvesIntent')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-warn font-bold">•</span>
              <span>
                <strong>{t('commercialProof.notProvesProprietaryLead')}</strong>
                {t('commercialProof.notProvesProprietaryBody')}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </Panel>
  );
}
