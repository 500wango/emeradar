import { OpportunityService } from '@emeradar/services';
import { FeedClient } from '@/components/FeedClient';
import { Radar } from 'lucide-react';

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

      {/* Interactive Client Feed */}
      <FeedClient initialItems={feed.items} total={feed.total} />
    </div>
  );
}
