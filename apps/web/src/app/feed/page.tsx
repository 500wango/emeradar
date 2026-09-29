import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService, EntitlementService, OpportunityService } from '@emeradar/services';
import { FeedClient } from '@/components/FeedClient';
import { TrackRequest } from '@/components/TrackRequest';

export default async function FeedPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login?next=%2Ffeed');
  const ent = await EntitlementService.getUserEntitlements(session.user.id);
  const feedDelayDays = ent.feedDelayDays;
  const planLabel = ent.planCode;
  const realtime = feedDelayDays === 0;
  const feed = await OpportunityService.listFeedCards({ limit: 10, minAgeDays: feedDelayDays });
  const observations = realtime
    ? await OpportunityService.listLiveObservations({ limit: 20 })
    : [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-8 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
          Decision feed
        </p>
        <h1 className="mt-1 text-3xl font-extrabold text-slate-900 tracking-tight">
          Today’s published opportunities
        </h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          Up to 10 tracked decisions. This session is {planLabel}: published decisions
          {realtime ? ' are current' : ` appear ${feedDelayDays} days after the first observation`}.
          Research market for this release is the United States, English.
        </p>
      </div>

      <div className="mb-8">
        <TrackRequest />
      </div>

      <FeedClient initialItems={feed.items} total={feed.total} />

      <section className="mt-14">
        <h2 className="text-xl font-bold text-slate-900">Emerging market candidates</h2>
        {realtime ? (
        <p className="mt-1 text-sm text-slate-500 max-w-3xl">
          These candidates are discovered from search signals and are still being observed.
          They are not published verdicts: one observation is not a market conclusion.
        </p>
        ) : (
        <p className="mt-1 text-sm text-slate-600 max-w-3xl">
          Realtime observations are part of Pro. Free shows published decisions after {feedDelayDays} days.
        </p>
        )}
        {realtime && observations.length > 0 && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs text-slate-600">
            {[
              ['1', 'Signal found'],
              ['2', 'Candidate created'],
              ['3', 'Observation history'],
              ['4', 'D / M / W scoring'],
              ['5', 'Published track record'],
            ].map(([step, label], index) => (
              <div key={step} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                <span className="font-mono font-bold text-blue-700">{step}</span>
                <span>{label}</span>
                {index < 4 && <span className="hidden sm:inline text-slate-300">→</span>}
              </div>
            ))}
          </div>
        )}
        {realtime && observations.length === 0 && (
          <p className="mt-6 text-sm text-slate-600">No emerging candidates stored yet.</p>
        )}
        {realtime && observations.length > 0 && (
          <div className="mt-6 grid md:grid-cols-2 gap-4">
            {observations.map((item) => (
              <Link
                key={item.opportunityId}
                href={`/opportunities/${item.slug}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-blue-300"
              >
                <div className="text-xs font-semibold text-slate-500">
                  {item.marketCountry} · {item.researchLanguage} · {item.confidence} confidence
                </div>
                <h3 className="mt-2 font-bold text-slate-900">{item.primaryQuery}</h3>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed line-clamp-3">
                  {item.featuredEvidenceSnippet || item.whyNowSummary}
                </p>
                <p className="mt-3 text-xs font-semibold text-slate-700">
                  D {item.dBand} · M {item.mBand} · W {item.wBand}
                </p>
                <div className="mt-3 text-[11px] text-slate-500">
                  Observation coverage: {item.observationDays ?? 0} autocomplete days
                  {' · '}{item.serpObservationDays ?? 0} SERP days
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {item.discoverySource ? `Source: ${item.discoverySource}. ` : ''}
                  {item.candidateReason || 'Discovered from recent search signals; evidence is still being collected.'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
