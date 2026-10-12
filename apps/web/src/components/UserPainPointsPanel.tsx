'use client';

import React from 'react';
import {
  HelpCircle,
  ExternalLink,
  Github,
  MessageSquare,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { BuildArchetype } from '@emeradar/core';
import { useI18n } from '@/lib/i18n';
import { safeExternalUrl } from '@/lib/format';
import { Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';

interface SerpResultItem {
  rank: number;
  url: string;
  domain: string;
  title: string;
  snippet?: string;
  result_type: string;
  is_weak: boolean;
  weakness_type?: string;
}

interface UserPainPointsPanelProps {
  primaryQuery: string;
  recommendedArchetype: BuildArchetype;
  executionClass: string;
  topIdea: string;
  serpResults?: SerpResultItem[];
}

export function UserPainPointsPanel({
  primaryQuery,
  recommendedArchetype,
  executionClass,
  topIdea,
  serpResults = [],
}: UserPainPointsPanelProps) {
  const { t } = useI18n();

  // Extract real community questions (StackOverflow, HackerNews)
  const communityDiscussions = serpResults.filter((r) => {
    const domain = r.domain.toLowerCase();
    return domain.includes('stackoverflow.com') || domain === 'news.ycombinator.com' || domain.endsWith('.news.ycombinator.com');
  });

  const openSourceTools = serpResults.filter((r) => {
    const domain = r.domain.toLowerCase();
    return domain === 'github.com' || domain.endsWith('.github.com');
  });

  const mediaArticles = serpResults.filter(
    (r) => r.result_type === 'EDITORIAL_MEDIA' || r.result_type === 'LISTICLE_AFFILIATE'
  );

  const shape = recommendedArchetype.replace(/_/g, ' ');

  return (
    <Panel className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-sm bg-info/10 text-info">
              <MessageSquare className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-fg">{t('painPoints.title')}</h2>
          </div>
          <p className="text-xs text-fg-subtle mt-1">
            {t('painPoints.desc', { query: primaryQuery })}
          </p>
        </div>

        {/* 这里刻意不用 Badge：Badge 是 nowrap 的（它承载的是 DEMAND / Tier A
            这类短仪器标签），而这一条是拼出来的长句子 —— 在 375 宽度下单枚徽章
            就有 490px，会把整个栅格列顶到 540px，页面横向滚出 180px。 */}
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle sm:shrink-0 sm:text-right">
          {t('painPoints.shapeBadge')}{' '}
          <span className="text-fg">
            {shape} (Class {executionClass})
          </span>
        </p>
      </div>

      <div className="space-y-6">
        {/* Real Community Q&A */}
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-fg mb-2.5">
            <HelpCircle className="w-4 h-4 text-warn" />
            <span>{t('painPoints.qaTitle')}</span>
            <span className="text-[10px] font-mono text-fg-subtle">
              {t('painPoints.qaCaptured', { count: communityDiscussions.length })}
            </span>
          </div>

          {communityDiscussions.length > 0 ? (
            <div className="space-y-2">
              {communityDiscussions.map((item) => (
                <div
                  key={item.rank}
                  className="p-3 rounded-sm bg-surface-2 border border-line hover:border-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={safeExternalUrl(item.url) ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-fg hover:text-accent hover:underline inline-flex items-center gap-1.5"
                    >
                      <span>{item.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                    </a>
                    <Badge tone="warn">{item.domain}</Badge>
                  </div>
                  {item.snippet && (
                    <p className="text-[11px] text-fg-subtle mt-1 leading-relaxed">{item.snippet}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 rounded-sm bg-surface-2 border border-line text-xs text-fg-subtle">
              {t('painPoints.noQa')}
            </div>
          )}
        </div>

        {/* Real Open Source Repos */}
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-fg mb-2.5">
            <Github className="w-4 h-4 text-fg" />
            <span>{t('painPoints.githubTitle')}</span>
            <span className="text-[10px] font-mono text-fg-subtle">
              {t('painPoints.githubCaptured', { count: openSourceTools.length })}
            </span>
          </div>

          {openSourceTools.length > 0 ? (
            <div className="space-y-2">
              {openSourceTools.map((item) => (
                <div
                  key={item.rank}
                  className="p-3 rounded-sm bg-surface-2 border border-line hover:border-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={safeExternalUrl(item.url) ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-fg hover:text-accent hover:underline inline-flex items-center gap-1.5 font-mono"
                    >
                      <span>{item.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                    </a>
                    <Badge tone="neutral">GitHub</Badge>
                  </div>
                  {item.snippet && (
                    <p className="text-[11px] text-fg-subtle mt-1 leading-relaxed">{item.snippet}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 rounded-sm bg-surface-2 border border-line text-xs text-fg-subtle">
              {t('painPoints.noGithub')}
            </div>
          )}
        </div>

        {/* Industry Media & Listicles */}
        {mediaArticles.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-fg mb-2.5">
              <BookOpen className="w-4 h-4 text-accent" />
              <span>{t('painPoints.mediaTitle')}</span>
              <span className="text-[10px] font-mono text-fg-subtle">
                {t('painPoints.mediaCaptured', { count: mediaArticles.length })}
              </span>
            </div>

            <div className="space-y-2">
              {mediaArticles.map((item) => (
                <div
                  key={item.rank}
                  className="p-3 rounded-sm bg-surface-2 border border-line hover:border-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={safeExternalUrl(item.url) ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-fg hover:text-accent hover:underline inline-flex items-center gap-1.5"
                    >
                      <span>{item.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                    </a>
                    <Badge tone="accent">{item.domain}</Badge>
                  </div>
                  {item.snippet && (
                    <p className="text-[11px] text-fg-subtle mt-1 leading-relaxed">{item.snippet}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Builder Opportunity Concept */}
        <div className="p-4 rounded-sm bg-signal/10 border border-signal/30">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="w-4 h-4 text-signal" />
            <h3 className="text-xs font-bold text-signal">{t('painPoints.storedRecommendation')}</h3>
          </div>
          <p className="text-xs text-fg leading-relaxed font-medium">{topIdea}</p>
          <p className="text-[11px] text-fg-subtle mt-2">
            {t('painPoints.storedRecommendationNote', { shape, cls: executionClass })}
          </p>
        </div>
      </div>
    </Panel>
  );
}
