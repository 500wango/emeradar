'use client';

import React, { useEffect, useState } from 'react';
import { useEvidenceDrawer } from '../lib/evidence-store';
import { formatDate } from '../lib/format';
import { useI18n } from '@/lib/i18n';

export function EvidenceDrawer() {
  const { isOpen, selectedEvidence, closeDrawer } = useEvidenceDrawer();
  const [copied, setCopied] = useState(false);
  const { t, isZh } = useI18n();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeDrawer]);

  if (!isOpen || !selectedEvidence) return null;

  const copyId = () => {
    navigator.clipboard.writeText(selectedEvidence.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // The drawer is the one surface in the product that stays dark, so its
  // badges use the `inverse-*` signal tokens rather than the main ones: the
  // main signal colours are dark inks chosen for paper and land at ~2.6:1
  // here. Both sets are contrast-checked, they are simply for opposite
  // backgrounds.
  const getClassBadge = (evClass: string) => {
    const key = `common.evidenceClasses.${evClass}`;
    const label = t(key);
    switch (evClass) {
      case 'OBSERVED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-inverse-signal/20 text-inverse-signal border border-inverse-signal/40">
            {label}
          </span>
        );
      case 'SELF_REPORTED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-inverse-warn/20 text-inverse-warn border border-inverse-warn/40">
            {label}
          </span>
        );
      case 'THIRD_PARTY_ESTIMATE':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-inverse-info/20 text-inverse-info border border-inverse-info/40">
            {label}
          </span>
        );
      case 'INFERRED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-inverse-accent/20 text-inverse-accent border border-inverse-accent/40">
            {label}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-inverse-line text-inverse-fg">
            {evClass}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-overlay/60 backdrop-blur-sm transition-opacity"
        onClick={closeDrawer}
      />

      {/* Slide-over panel */}
      <div className="on-inverse relative w-full max-w-xl bg-inverse border-l border-inverse-line shadow-2xl p-6 overflow-y-auto z-10 flex flex-col justify-between">
        <div>
          {/* Header */}
          <div className="flex items-start justify-between pb-4 border-b border-inverse-line">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-mono text-inverse-fg-subtle">
                  {selectedEvidence.id}
                </span>
                <button
                  type="button"
                  onClick={copyId}
                  className="text-xs text-inverse-info hover:brightness-110 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inverse-info"
                >
                  {copied ? (isZh ? '已复制' : 'Copied') : (isZh ? '复制ID' : 'Copy ID')}
                </button>
              </div>
              <h2 className="text-lg font-bold text-inverse-fg leading-tight">
                {selectedEvidence.title}
              </h2>
            </div>
            <button
              type="button"
              aria-label={isZh ? '关闭证据抽屉' : 'Close evidence drawer'}
              onClick={closeDrawer}
              className="p-1 rounded-lg text-inverse-fg-muted hover:text-inverse-fg hover:bg-inverse-fg/10 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inverse-info"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-4 py-4 border-b border-inverse-line text-sm">
            <div>
              <span className="text-xs text-inverse-fg-subtle block mb-1">
                {isZh ? '证据等级 (Evidence Class)' : 'Evidence Class'}
              </span>
              <div>{getClassBadge(selectedEvidence.evidenceClass)}</div>
            </div>
            <div>
              <span className="text-xs text-inverse-fg-subtle block mb-1">
                {isZh ? '观测时间 (Observed At)' : 'Observed At'}
              </span>
              <span className="text-inverse-fg font-mono text-xs">
                {formatDate(selectedEvidence.observedAt)}
              </span>
            </div>
            <div>
              <span className="text-xs text-inverse-fg-subtle block mb-1">
                {isZh ? '来源类型 / 采集源' : 'Source Type / Origin'}
              </span>
              <span className="text-inverse-fg font-mono text-xs">
                {selectedEvidence.sourceType} ({selectedEvidence.sourceId})
              </span>
            </div>
            <div>
              <span className="text-xs text-inverse-fg-subtle block mb-1">
                {isZh ? '归属域名' : 'Domain'}
              </span>
              <span className="text-inverse-fg font-mono text-xs">
                {selectedEvidence.domain || (isZh ? '全域 / 聚合' : 'Global / Aggregated')}
              </span>
            </div>
          </div>

          {/* Snippet / Context */}
          <div className="py-4 border-b border-inverse-line">
            <span className="text-xs font-semibold text-inverse-fg-subtle uppercase tracking-wider block mb-2">
              {isZh ? '观测事实摘要 (Observed Snippet)' : 'Observed Snippet'}
            </span>
            <div className="bg-overlay/50 p-3 rounded-lg border border-inverse-line/60 text-sm text-inverse-fg-muted leading-relaxed font-mono">
              {selectedEvidence.snippet}
            </div>
          </div>

          {/* Structured Payload */}
          <div className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-inverse-fg-subtle uppercase tracking-wider">
                {isZh ? '原始载荷解析 (Structured Payload)' : 'Structured Payload'}
              </span>
              <span className="text-xs text-inverse-signal flex items-center gap-1 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-inverse-signal"></span>
                {isZh ? '来源载荷已记录' : 'Source payload recorded'}
              </span>
            </div>
            <pre className="bg-overlay/50 p-4 rounded-lg border border-inverse-line/60 text-xs font-mono text-inverse-info overflow-x-auto max-h-72 leading-relaxed">
              {JSON.stringify(selectedEvidence.payload, null, 2)}
            </pre>
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-4 border-t border-inverse-line text-xs text-inverse-fg-subtle flex items-center justify-between">
          <span>{isZh ? 'Emeradar 事实护栏与防幻觉抽屉' : 'Emeradar Fact Guardrail & Anti-Hallucination Drawer'}</span>
          <span>{isZh ? '按 ESC 键或点击遮罩关闭' : 'Press ESC or click backdrop to close'}</span>
        </div>
      </div>
    </div>
  );
}
