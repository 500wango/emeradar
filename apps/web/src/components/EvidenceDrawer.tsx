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

  const getClassBadge = (evClass: string) => {
    const key = `common.evidenceClasses.${evClass}`;
    const label = t(key);
    switch (evClass) {
      case 'OBSERVED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
            {label}
          </span>
        );
      case 'SELF_REPORTED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40">
            {label}
          </span>
        );
      case 'THIRD_PARTY_ESTIMATE':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-sky-500/20 text-sky-400 border border-sky-500/40">
            {label}
          </span>
        );
      case 'INFERRED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-400 border border-purple-500/40">
            {label}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-700 text-slate-300">
            {evClass}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={closeDrawer}
      />

      {/* Slide-over panel */}
      <div className="relative w-full max-w-xl bg-slate-900 border-l border-slate-800 shadow-2xl p-6 overflow-y-auto z-10 flex flex-col justify-between">
        <div>
          {/* Header */}
          <div className="flex items-start justify-between pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-mono text-slate-400">
                  {selectedEvidence.id}
                </span>
                <button
                  onClick={copyId}
                  className="text-xs text-sky-400 hover:text-sky-300 font-medium"
                >
                  {copied ? (isZh ? '已复制' : 'Copied') : (isZh ? '复制ID' : 'Copy ID')}
                </button>
              </div>
              <h2 className="text-lg font-bold text-white leading-tight">
                {selectedEvidence.title}
              </h2>
            </div>
            <button
              onClick={closeDrawer}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
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
          <div className="grid grid-cols-2 gap-4 py-4 border-b border-slate-800 text-sm">
            <div>
              <span className="text-xs text-slate-400 block mb-1">
                {isZh ? '证据等级 (Evidence Class)' : 'Evidence Class'}
              </span>
              <div>{getClassBadge(selectedEvidence.evidenceClass)}</div>
            </div>
            <div>
              <span className="text-xs text-slate-400 block mb-1">
                {isZh ? '观测时间 (Observed At)' : 'Observed At'}
              </span>
              <span className="text-slate-200 font-mono text-xs">
                {formatDate(selectedEvidence.observedAt)}
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-400 block mb-1">
                {isZh ? '来源类型 / 采集源' : 'Source Type / Origin'}
              </span>
              <span className="text-slate-200 font-mono text-xs">
                {selectedEvidence.sourceType} ({selectedEvidence.sourceId})
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-400 block mb-1">
                {isZh ? '归属域名' : 'Domain'}
              </span>
              <span className="text-slate-200 font-mono text-xs">
                {selectedEvidence.domain || (isZh ? '全域 / 聚合' : 'Global / Aggregated')}
              </span>
            </div>
          </div>

          {/* Snippet / Context */}
          <div className="py-4 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              {isZh ? '观测事实摘要 (Observed Snippet)' : 'Observed Snippet'}
            </span>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 text-sm text-slate-300 leading-relaxed font-mono">
              {selectedEvidence.snippet}
            </div>
          </div>

          {/* Structured Payload */}
          <div className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {isZh ? '原始载荷解析 (Structured Payload)' : 'Structured Payload'}
              </span>
              <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                {isZh ? 'RFC 6962 默克尔账本已固化' : 'RFC 6962 Merkle Ledger Sealed'}
              </span>
            </div>
            <pre className="bg-slate-950 p-4 rounded-lg border border-slate-800/80 text-xs font-mono text-sky-300 overflow-x-auto max-h-72 leading-relaxed">
              {JSON.stringify(selectedEvidence.payload, null, 2)}
            </pre>
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-4 border-t border-slate-800 text-xs text-slate-500 flex items-center justify-between">
          <span>{isZh ? 'Emeradar 事实护栏与防幻觉抽屉' : 'Emeradar Fact Guardrail & Anti-Hallucination Drawer'}</span>
          <span>{isZh ? '按 ESC 键或点击遮罩关闭' : 'Press ESC or click backdrop to close'}</span>
        </div>
      </div>
    </div>
  );
}
