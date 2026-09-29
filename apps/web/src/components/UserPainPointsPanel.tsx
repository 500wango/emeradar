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

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <MessageSquare className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-slate-900">
              Source-labeled mentions
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            For &quot;{primaryQuery}&quot;. A row is listed under Stack Overflow, Hacker News, or GitHub only when its domain says so. Other stored rows stay in the result sample.
          </p>
        </div>

        <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-700 shrink-0">
          目标形态: {recommendedArchetype.replace('_', ' ')} (Class {executionClass})
        </span>
      </div>

      <div className="space-y-6">
        {/* Real Community Q&A */}
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 mb-2.5">
            <HelpCircle className="w-4 h-4 text-amber-600" />
            <span>Stack Overflow and Hacker News URLs</span>
            <span className="text-[10px] font-mono text-slate-400">
              ({communityDiscussions.length} 条已捕获)
            </span>
          </div>

          {communityDiscussions.length > 0 ? (
            <div className="space-y-2">
              {communityDiscussions.map((item) => (
                <div
                  key={item.rank}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-100/70 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-slate-900 hover:text-blue-600 hover:underline inline-flex items-center gap-1.5"
                    >
                      <span>{item.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </a>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
                      {item.domain}
                    </span>
                  </div>
                  {item.snippet && (
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      {item.snippet}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-50 text-xs text-slate-400">
              No stackoverflow.com or news.ycombinator.com URLs are stored.
            </div>
          )}
        </div>

        {/* Real Open Source Repos */}
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 mb-2.5">
            <Github className="w-4 h-4 text-slate-800" />
            <span>github.com URLs</span>
            <span className="text-[10px] font-mono text-slate-400">
              ({openSourceTools.length} 个已捕获)
            </span>
          </div>

          {openSourceTools.length > 0 ? (
            <div className="space-y-2">
              {openSourceTools.map((item) => (
                <div
                  key={item.rank}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-100/70 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-slate-900 hover:text-blue-600 hover:underline inline-flex items-center gap-1.5 font-mono"
                    >
                      <span>{item.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </a>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 shrink-0">
                      GitHub
                    </span>
                  </div>
                  {item.snippet && (
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      {item.snippet}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-50 text-xs text-slate-400">
              No github.com URLs are stored.
            </div>
          )}
        </div>

        {/* Industry Media & Listicles */}
        {mediaArticles.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 mb-2.5">
              <BookOpen className="w-4 h-4 text-blue-600" />
              <span>Editorial and listicle rows (domain shown)</span>
              <span className="text-[10px] font-mono text-slate-400">
                ({mediaArticles.length} 篇已捕获)
              </span>
            </div>

            <div className="space-y-2">
              {mediaArticles.map((item) => (
                <div
                  key={item.rank}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-100/70 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-slate-900 hover:text-blue-600 hover:underline inline-flex items-center gap-1.5"
                    >
                      <span>{item.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </a>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 shrink-0">
                      {item.domain}
                    </span>
                  </div>
                  {item.snippet && (
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      {item.snippet}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Builder Opportunity Concept */}
        <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
              Stored recommendation
            </h3>
          </div>
          <p className="text-xs text-emerald-900 leading-relaxed font-medium">
            {topIdea}
          </p>
          <p className="text-[11px] text-emerald-800 mt-2">
            Shape on file: {recommendedArchetype.replace(/_/g, ' ')} · Class {executionClass}. This sentence is the stored recommendation, not a summary of the rows above.
          </p>
        </div>
      </div>
    </div>
  );
}
