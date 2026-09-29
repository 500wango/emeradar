import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  ShieldCheck,
  TrendingUp,
  Sparkles,
  Zap,
  ArrowRight,
  FileText,
  AlertTriangle,
  ChevronLeft,
  CheckCircle2,
  Lock,
  ExternalLink,
} from 'lucide-react';
import { AuthService, EntitlementService, OpportunityService } from '@emeradar/services';
import { formatDate } from '@/lib/format';
import { EvidenceInteractiveList } from '@/components/EvidenceInteractiveList';
import { CommercialProofPanel } from '@/components/CommercialProofPanel';
import { GoogleTrendsPanel } from '@/components/GoogleTrendsPanel';
import { UserPainPointsPanel } from '@/components/UserPainPointsPanel';
import { DecisionBar } from '@/components/DecisionBar';

interface OpportunityWorkspacePageProps {
  params: Promise<{ slug: string }>;
}

export default async function OpportunityWorkspacePage({
  params,
}: OpportunityWorkspacePageProps) {
  const { slug } = await params;
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect(`/login?next=${encodeURIComponent(`/opportunities/${slug}`)}`);
  const ent = await EntitlementService.getUserEntitlements(session.user.id);
  if (!ent.opportunityDetailFull) redirect('/pricing?feature=opportunity-detail');

  let data: any;
  try {
    data = await OpportunityService.getOpportunityDetail(slug);
  } catch {
    notFound();
  }

  const { opportunity, queries, serpResults, evidence, commercialProof, killCriteria, latestVerdict } = data;

  const isBuildNow = opportunity.verdict === 'BUILD_NOW';
  const isEarlyBet = opportunity.verdict === 'EARLY_BET';
  const canGo =
    opportunity.status === 'TRACKED' &&
    (isBuildNow || isEarlyBet) &&
    opportunity.confidence !== 'LOW';
  const blockReason = canGo
    ? undefined
    : 'GO stays off until this record is a published BUILD NOW or EARLY BET. A first observation is only tracking.';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Back to Feed Link */}
      <Link
        href="/feed"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to Opportunity Feed</span>
      </Link>

      {/* Hero Decision Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm mb-10">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  isBuildNow
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : isEarlyBet
                    ? 'bg-blue-100 text-blue-800 border border-blue-200'
                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                {opportunity.verdict}
              </span>
              <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                {opportunity.lifecycle}
              </span>
              <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                {opportunity.market_country} ({opportunity.research_language})
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {opportunity.title}
            </h1>

            <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
              <span>Primary Seed Query:</span>
              <code className="text-slate-800 bg-slate-100 px-2 py-0.5 rounded font-mono font-medium">
                {opportunity.primary_query}
              </code>
            </div>
          </div>

          <DecisionBar
            opportunityId={opportunity.id}
            slug={opportunity.slug}
            title={opportunity.title}
            canGo={canGo}
            canExport={canGo}
            blockReason={blockReason}
          />
        </div>

        {/* D-M-W Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
              <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
              <span>Demand Score (D)</span>
            </div>
            <div className="text-2xl font-bold text-blue-600 mt-1">{opportunity.d_band}</div>
            <div className="text-[11px] text-slate-500 mt-1">Demand band</div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Commercial (M)</span>
            </div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">{opportunity.m_band}</div>
            <div className="text-[11px] text-slate-500 mt-1">Commercial band</div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
              <Zap className="w-3.5 h-3.5 text-amber-600" />
              <span>Window (W)</span>
            </div>
            <div className="text-2xl font-bold text-amber-600 mt-1">{opportunity.w_band}</div>
            <div className="text-[11px] text-slate-500 mt-1">Window band</div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span>Evidence Level</span>
            </div>
            <div className="text-2xl font-bold text-indigo-600 mt-1">
              {opportunity.confidence}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {opportunity.confidence === 'LOW' ? 'Not enough history' : 'Evidence confidence'}
            </div>
          </div>
        </div>
        <div className="mt-6 pt-5 border-t border-slate-100">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-bold text-slate-900">Decision progress</h2>
            <span className="text-[11px] text-slate-500">
              {opportunity.status === 'TRACKED' ? 'Published record' : 'Still observing'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] text-slate-600">
            {[
              ['Signal', true],
              ['Candidate', true],
              ['Observation', opportunity.status === 'TRACKED'],
              ['D / M / W gate', opportunity.status === 'TRACKED'],
              ['Public prediction', opportunity.status === 'TRACKED' && Boolean(latestVerdict)],
            ].map(([label, done], index) => (
              <div key={String(label)} className={`rounded-lg border px-3 py-2 ${done ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-slate-50'}`}>
                <span className="font-mono font-bold">{index + 1}</span>{' '}{label}
              </div>
            ))}
          </div>
          {opportunity.status !== 'TRACKED' && (
            <p className="mt-3 text-xs text-slate-500">
              This is a system-discovered candidate. The first observation is not a verdict; GO and report export stay locked until the evidence gate passes.
            </p>
          )}
        </div>
      </div>

      {/* Decision Workspace Content Sections */}
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left Column (2 Cols): Core Analytical Deep Dive */}
        <div className="lg:col-span-2 space-y-8">
          {/* Section 1: Google Trends Demand & Trajectory */}
          {isEarlyBet && (
            <p className="text-sm font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              Commercial case unverified. EARLY BET is not proof that anyone is paying.
            </p>
          )}
          <GoogleTrendsPanel
            query={opportunity.primary_query}
            marketCountry={opportunity.market_country}
            clusterQueries={queries}
          />

          {/* Section 2: Real User Needs & Frustration Analysis */}
          <UserPainPointsPanel
            primaryQuery={opportunity.primary_query}
            recommendedArchetype={opportunity.recommended_archetype}
            executionClass={opportunity.execution_class}
            topIdea={opportunity.top_idea}
            serpResults={serpResults}
          />

          {/* Section 3: Why Now & Top Concept */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
              <span>Why Now? & Market Catalyst</span>
            </h2>
            <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-100 text-xs text-blue-900 leading-relaxed">
              {opportunity.why_now_summary}
            </div>

            <div className="mt-4 p-4 rounded-xl bg-emerald-50/70 border border-emerald-100 text-xs text-emerald-900 leading-relaxed">
              <strong>💡 Recommended Product Concept:</strong> {opportunity.top_idea}
            </div>
          </div>

          {/* Section 2: SERP Weakness Inspector */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Stored result sample
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Rows keep the source they were collected from. This table is a Google organic Top 10 only when the snapshot is a single-source SERP.
                </p>
              </div>
              <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                {serpResults.filter((r: any) => r.is_weak).length} marked weak
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Domain</th>
                    <th className="py-2.5 px-3">Result Title</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Weakness Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {serpResults.map((r: any) => (
                    <tr key={r.rank} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3 font-bold text-slate-400 align-top">{r.rank}</td>
                      <td className="py-3 px-3 font-semibold text-slate-800 align-top">
                        <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-mono">
                          {r.domain}
                        </span>
                      </td>
                      <td className="py-3 px-3 max-w-md align-top">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-slate-900 hover:text-blue-600 hover:underline inline-flex items-center gap-1.5 group"
                          title={r.title}
                        >
                          <span className="line-clamp-1">{r.title}</span>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 shrink-0" />
                        </a>
                        {r.snippet && (
                          <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                            {r.snippet}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-3 align-top">
                        <code className="text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                          {r.result_type}
                        </code>
                      </td>
                      <td className="py-3 px-3 align-top">
                        {r.is_weak ? (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-medium text-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            {r.weakness_type || 'Thin Content'}
                          </span>
                        ) : (
                          <span className="text-slate-600 font-medium text-xs">
                            {r.result_type === 'SPECIALIST' || r.result_type === 'OFFICIAL'
                              ? 'Specialist or official'
                              : 'Not marked weak'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 3: Query Cluster Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Search Query Cluster Matrix
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Long-tail queries sharing intent in this cluster
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
              {queries.map((q: any) => (
                <div
                  key={q.id}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs"
                >
                  <code className="font-mono text-slate-800 font-medium">{q.query_text}</code>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                    Tier {q.tier}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Commercial Signal Proof Boundary (PRD F7) */}
          <CommercialProofPanel
            stage={commercialProof?.stage || 'NONE'}
            gateways={commercialProof?.gateways || []}
            plansCount={commercialProof?.plansCount || 0}
          />

          {/* Section 5: Corroborating Evidence Chain with Slide-Over Drawer */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Corroborating Evidence Chain
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Raw verifiable signals from SERP, social forums, and web pricing (click any item to inspect raw Merkle-anchored payload)
                </p>
              </div>
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                {evidence.length} Items Recorded
              </span>
            </div>

            <EvidenceInteractiveList evidence={evidence} />
          </div>
        </div>

        {/* Right Column (1 Col): Rules, Blueprint & Ledger */}
        <div className="space-y-8">
          {/* Execution Blueprint Recommendation */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
              Stored build shape
            </h3>

            <div className="space-y-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-1">Recommended Archetype</span>
                <span className="font-bold text-base text-slate-900">
                  {opportunity.recommended_archetype}
                </span>
              </div>

              <div>
                <span className="text-slate-400 block mb-1">Development Time Budget</span>
                <span className="font-bold text-sm text-slate-900">
                  Class {opportunity.execution_class} &bull; &lt; 14 Days Sprint
                </span>
              </div>

              <div className="pt-3 border-t border-slate-100">
                <span className="text-slate-400 block mb-2">Recommended Stack</span>
                <ul className="space-y-1.5 text-slate-700">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Next.js 15+ App Router
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Tailwind CSS (Zero-bloat UI)
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    PostgreSQL / Supabase
                  </li>
                </ul>
              </div>

              <div className="pt-4 border-t border-slate-100">
                {canGo ? (
                  <Link
                    href={`/opportunities/${opportunity.slug}/report`}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold transition-colors text-xs"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Open the report</span>
                  </Link>
                ) : (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    The six-section report is exported only after a published BUILD NOW or EARLY BET.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Kill Criteria Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-rose-600 mb-1 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              <span>Automated Kill Criteria</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Hard rules that invalidate this opportunity
            </p>

            <div className="space-y-3">
              {killCriteria.map((kc: any) => (
                <div
                  key={kc.id}
                  className="p-3 rounded-xl bg-rose-50/60 border border-rose-100 text-xs text-rose-900"
                >
                  <span className="font-bold font-mono text-[11px] block mb-0.5">
                    {kc.rule_code}
                  </span>
                  {kc.description}
                </div>
              ))}
            </div>
          </div>

          {/* Cryptographic Ledger Verification Card */}
          <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-md">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Merkle Ledger Proof
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              This verdict was sealed on {formatDate(latestVerdict?.obs_date)} into the public SHA-256 hash chain.
            </p>

            <div className="space-y-2 text-[11px] font-mono">
              <div>
                <span className="text-slate-500 block">Row Hash:</span>
                <span className="text-slate-300 break-all select-all">
                  {latestVerdict?.row_hash || 'Calculating...'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800">
                <span className="text-slate-500 block">Previous Hash:</span>
                <span className="text-slate-300 break-all select-all">
                  {latestVerdict?.prev_hash || 'Genesis'}
                </span>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-800 text-center">
              <Link
                href="/track-record"
                className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
              >
                <span>Verify on Track Record Ledger</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
