import Link from 'next/link';
import {
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  Search,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import { OpportunityService } from '@emeradar/services';
import { Logo } from '@/components/Logo';
import { LiveScanner } from '@/components/LiveScanner';
import { IdeationHub } from '@/components/IdeationHub';

export default async function HomePage() {
  const feed = await OpportunityService.listFeedCards({ limit: 2 });

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50/50 via-white to-slate-50 border-b border-slate-200/80 pt-16 pb-20 lg:pt-20 lg:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          {/* Main Logo Display */}
          <div className="flex justify-center mb-8">
            <Logo variant="full" className="h-20 sm:h-24 w-auto max-w-full drop-shadow-sm" idPrefix="hero-main" />
          </div>

          {/* Top Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-blue-100/80 text-blue-800 border border-blue-200 mb-8 shadow-sm">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            <span>Cryptographically Verified Merkle Ledger &bull; 82.5% Predictive Accuracy</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 max-w-4xl mx-auto leading-[1.15]">
            Stop Guessing What to Build.{' '}
            <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent">
              Ship Into Validated Search Demand.
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto font-normal leading-relaxed">
            Emeradar scans millions of search queries to detect emerging customer intent, identifies attackable SERP weakness, and confirms commercial willingness to pay before you write a line of code.
          </p>

          {/* Live Scanner Search Bar in Hero */}
          <div className="mt-10 max-w-2xl mx-auto text-left">
            <LiveScanner />
          </div>

          {/* Social Proof Stats */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto border-t border-slate-200/60 pt-10">
            <div>
              <div className="text-3xl font-bold text-slate-900">82.5%</div>
              <div className="text-xs text-slate-500 font-medium mt-1">30-Day Market Formation</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-blue-600">D &bull; M &bull; W</div>
              <div className="text-xs text-slate-500 font-medium mt-1">Tri-Axis Deterministic Scoring</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-emerald-600">100%</div>
              <div className="text-xs text-slate-500 font-medium mt-1">SHA-256 Merkle Proven</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-900">14-Day</div>
              <div className="text-xs text-slate-500 font-medium mt-1">Class-S Execution Blueprints</div>
            </div>
          </div>
        </div>
      </section>

      {/* Tri-Axis Methodology Section */}
      <section className="py-20 bg-white border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-2">
              The Emeradar Advantage
            </h2>
            <h3 className="text-3xl font-bold text-slate-900">
              Three Pillars of High-Probability Product Validation
            </h3>
            <p className="mt-3 text-slate-600 text-sm">
              We never rely on subjective opinions or vague trend charts. Every opportunity is scored across three rigorous mathematical dimensions.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Dimension 1: Demand */}
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200 hover:border-blue-300 transition-all hover:shadow-md">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-6">
                <Search className="w-6 h-6" />
              </div>
              <h4 className="text-lg font-bold text-slate-900 mb-2">1. Demand Velocity (D)</h4>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Measures 7-day query cluster expansion, autocomplete depth, and sustained search velocity. Filters out dead-end keywords and momentary viral spikes.
              </p>
              <ul className="text-xs text-slate-500 space-y-2">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                  Cluster growth rate &gt; 50%
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                  Long-tail autocomplete momentum
                </li>
              </ul>
            </div>

            {/* Dimension 2: Monetization */}
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200 hover:border-emerald-300 transition-all hover:shadow-md">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-6">
                <TrendingUp className="w-6 h-6" />
              </div>
              <h4 className="text-lg font-bold text-slate-900 mb-2">2. Commercial Signal (M)</h4>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Uncovers live pricing plans, Stripe gateways, and high CPC signals. Confirms that users are actively paying for solutions rather than seeking free tutorials.
              </p>
              <ul className="text-xs text-slate-500 space-y-2">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Independent paid competitors verified
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Negative signal platform checks
                </li>
              </ul>
            </div>

            {/* Dimension 3: Window */}
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200 hover:border-amber-300 transition-all hover:shadow-md">
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center mb-6">
                <Zap className="w-6 h-6" />
              </div>
              <h4 className="text-lg font-bold text-slate-900 mb-2">3. Competitive Window (W)</h4>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Audits Google SERP quality. When Top 10 results are clogged with outdated blogs, Reddit threads, and unhelpful forums, an attackable window is wide open.
              </p>
              <ul className="text-xs text-slate-500 space-y-2">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />
                  Over 50% weak results in Top 10
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />
                  Absence of dominant specialist incumbents
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Builder Ideation & Niche Matrix */}
      <section className="py-16 bg-white border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <IdeationHub />
        </div>
      </section>

      {/* Featured Live Opportunities Spotlight */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-10 gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  Live Radar Feed Spotlight
                </span>
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">
                Highest-Velocity BUILD NOW Signals
              </h3>
            </div>

            <Link
              href="/feed"
              className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <span>View all opportunities</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {feed.items.map((opp) => (
              <div
                key={opp.opportunityId}
                className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                      {opp.verdict}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 uppercase">
                      Class {opp.executionClass} &bull; {opp.recommendedArchetype}
                    </span>
                  </div>

                  <Link
                    href={`/opportunities/${opp.slug}`}
                    className="font-bold text-lg text-slate-900 hover:text-blue-600 transition-colors line-clamp-2"
                  >
                    {opp.title}
                  </Link>

                  <p className="text-xs text-slate-600 mt-2 line-clamp-2 leading-relaxed">
                    💡 <strong>Concept:</strong> {opp.topIdea}
                  </p>

                  <div className="grid grid-cols-3 gap-3 my-5 p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
                    <div>
                      <div className="text-[10px] text-slate-500 font-semibold uppercase">Demand</div>
                      <div className="text-base font-bold text-blue-600 mt-0.5">
                        {(opp.dBasisPoints / 100).toFixed(0)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 font-semibold uppercase">Commercial</div>
                      <div className="text-base font-bold text-emerald-600 mt-0.5">
                        {(opp.mBasisPoints / 100).toFixed(0)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 font-semibold uppercase">Window</div>
                      <div className="text-base font-bold text-amber-600 mt-0.5">
                        {(opp.wBasisPoints / 100).toFixed(0)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    Query: <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{opp.primaryQuery}</code>
                  </span>

                  <Link
                    href={`/opportunities/${opp.slug}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"
                  >
                    <span>Inspect Opportunity</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
