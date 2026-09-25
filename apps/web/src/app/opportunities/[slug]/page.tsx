import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ShieldCheck,
  TrendingUp,
  Sparkles,
  Zap,
  ArrowRight,
  FileText,
  AlertTriangle,
  FolderPlus,
  ChevronLeft,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { OpportunityService } from '@emeradar/services';
import { formatDate } from '@/lib/format';

interface OpportunityWorkspacePageProps {
  params: Promise<{ slug: string }>;
}

export default async function OpportunityWorkspacePage({
  params,
}: OpportunityWorkspacePageProps) {
  const { slug } = await params;

  let data: any;
  try {
    data = await OpportunityService.getOpportunityDetail(slug);
  } catch {
    notFound();
  }

  const { opportunity, queries, serpResults, evidence, killCriteria, latestVerdict } = data;

  const dScore = (opportunity.d_basis_points / 100).toFixed(0);
  const mScore = (opportunity.m_basis_points / 100).toFixed(0);
  const wScore = (opportunity.w_basis_points / 100).toFixed(0);

  const isBuildNow = opportunity.verdict === 'BUILD_NOW';
  const isEarlyBet = opportunity.verdict === 'EARLY_BET';

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

          {/* Quick CTA Actions */}
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href={`/opportunities/${opportunity.slug}/report`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              <FileText className="w-4 h-4 text-blue-600" />
              <span>Export Research Report</span>
            </Link>

            <Link
              href={`/projects?new=${opportunity.id}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 transition-all"
            >
              <FolderPlus className="w-4 h-4" />
              <span>Create Tracking Project</span>
            </Link>
          </div>
        </div>

        {/* D-M-W Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
              <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
              <span>Demand Score (D)</span>
            </div>
            <div className="text-2xl font-bold text-blue-600 mt-1">
              {dScore} <span className="text-xs text-slate-400 font-normal">/ 100</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Band: {opportunity.d_band}</div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Commercial (M)</span>
            </div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {mScore} <span className="text-xs text-slate-400 font-normal">/ 100</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Band: {opportunity.m_band}</div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
              <Zap className="w-3.5 h-3.5 text-amber-600" />
              <span>Window (W)</span>
            </div>
            <div className="text-2xl font-bold text-amber-600 mt-1">
              {wScore} <span className="text-xs text-slate-400 font-normal">/ 100</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Band: {opportunity.w_band}</div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span>Evidence Level</span>
            </div>
            <div className="text-2xl font-bold text-indigo-600 mt-1">
              {opportunity.confidence}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Multi-source verified</div>
          </div>
        </div>
      </div>

      {/* Decision Workspace Content Sections */}
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left Column (2 Cols): Core Analytical Deep Dive */}
        <div className="lg:col-span-2 space-y-8">
          {/* Section 1: Why Now & Top Concept */}
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
                  Google SERP Weakness Audit
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Detailed inspection of Top 10 organic search results
                </p>
              </div>
              <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                {serpResults.filter((r: any) => r.is_weak).length} Weak Results in Top 10
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
                    <tr key={r.rank} className="hover:bg-slate-50">
                      <td className="py-3 px-3 font-bold text-slate-400">{r.rank}</td>
                      <td className="py-3 px-3 font-semibold text-slate-800">{r.domain}</td>
                      <td className="py-3 px-3 text-slate-600 max-w-xs truncate" title={r.title}>
                        {r.title}
                      </td>
                      <td className="py-3 px-3">
                        <code className="text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                          {r.result_type}
                        </code>
                      </td>
                      <td className="py-3 px-3">
                        {r.is_weak ? (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            {r.weakness_type || 'Thin Content'}
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-medium">
                            Established Specialist
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

          {/* Section 4: Evidence Traceability */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Corroborating Evidence Chain
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Raw signals from SERP, social forums, and commercial web pricing
            </p>

            <div className="space-y-3">
              {evidence.map((ev: any) => (
                <div
                  key={ev.id}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs"
                >
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="font-semibold text-slate-700">{ev.domain || ev.source_type}</span>
                    <span className="bg-slate-200/70 px-2 py-0.5 rounded text-[10px] uppercase font-bold text-slate-600">
                      {ev.evidence_class}
                    </span>
                  </div>
                  <p className="font-medium text-slate-900">{ev.title}</p>
                  <p className="text-slate-600 mt-1 italic">&ldquo;{ev.snippet}&rdquo;</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column (1 Col): Rules, Blueprint & Ledger */}
        <div className="space-y-8">
          {/* Execution Blueprint Recommendation */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
              Execution Blueprint
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
                <Link
                  href={`/opportunities/${opportunity.slug}/report`}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold transition-colors text-xs"
                >
                  <FileText className="w-4 h-4" />
                  <span>Open Full 6-Section Report</span>
                </Link>
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
