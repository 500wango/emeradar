import { OpportunityService } from '@emeradar/services';
import { FeedClient } from '@/components/FeedClient';
import { LiveScanner } from '@/components/LiveScanner';
import { Radar, Sparkles } from 'lucide-react';

export default async function FeedPage() {
  const feed = await OpportunityService.listFeedCards({ limit: 50 });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Feed Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2">
            <Radar className="w-5 h-5 text-blue-600 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
              Active Radar Scanner
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
            Search Opportunity Radar
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time feed of opportunities scored across Demand, Commercial Signals, and Competitive Windows.
          </p>
        </div>
      </div>

      {/* Live Keyword Scanner Bar */}
      <div className="mb-10 p-6 rounded-3xl bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-slate-50 border border-blue-100/80 shadow-sm">
        <div className="max-w-3xl mb-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            Scan Any Target Keyword Live
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Query real-time Google Autocomplete clusters & analyze SERP Top 10 weaknesses on demand.
          </p>
        </div>
        <LiveScanner />
      </div>

      {/* Interactive Client Feed */}
      <FeedClient initialItems={feed.items} total={feed.total} />
    </div>
  );
}
