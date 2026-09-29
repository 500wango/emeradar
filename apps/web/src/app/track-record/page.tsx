import Link from 'next/link';
import {
  ShieldCheck,
  CheckCircle2,
  ArrowUpRight,
  ExternalLink,
  Code2,
} from 'lucide-react';
import { TrackRecordService } from '@emeradar/services';
import { formatDate } from '@/lib/format';

export default async function TrackRecordPage() {
  const data = await TrackRecordService.getPublicTrackRecord();
  const { stats, episodes, checkpoints } = data;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="border-b border-slate-200 pb-8 mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 mb-4">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Cryptographically Sealed Append-Only Ledger</span>
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
          Verifiable Track Record & Historical Episodes
        </h1>
        <p className="mt-3 text-base text-slate-600 max-w-3xl leading-relaxed">
          Unlike black-box analytics tools, Emeradar commits every daily verdict to an append-only cryptographic ledger before outcomes unfold. No revisions, no cherry-picking, and complete transparency on hits and misses.
        </p>
      </div>

      {/* KPI Gauges */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-12">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            30-Day Hit Rate
          </span>
          <div className="text-3xl font-bold text-emerald-600 mt-2">
            {stats.hitRate30d ?? '—'}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            {stats.hitRate30d ? 'Cohort market formation' : 'No T+30 outcomes yet'}
          </span>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Evaluated Episodes
          </span>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {stats.evaluatedEpisodes}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            Passed 30-day evaluation horizon
          </span>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Total Ledger Predictions
          </span>
          <div className="text-3xl font-bold text-blue-600 mt-2">
            {stats.totalPredictions}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            Auditable verdict entries
          </span>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Ledger Checkpoints
          </span>
          <div className="text-3xl font-bold text-indigo-600 mt-2">
            {checkpoints.length}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            Daily Merkle tree roots
          </span>
        </div>
      </div>

      {/* Historical Episodes Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-12">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Historical Prediction Episodes
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Episodes tracking when opportunities entered high-conviction states
            </p>
          </div>
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            Evaluation Protocol: ev-1.0
          </span>
        </div>

        {episodes.length === 0 && (
          <p className="px-6 py-8 text-sm text-slate-600">
            No evaluated episodes yet. A hit rate is published only after a real verdict has a T+30 outcome. Example rows are not shown.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase font-semibold border-b border-slate-200">
              <tr>
                <th className="py-3 px-6">Opportunity</th>
                <th className="py-3 px-6">Published Verdict</th>
                <th className="py-3 px-6">Predicted Date</th>
                <th className="py-3 px-6">T+30d Outcome</th>
                <th className="py-3 px-6">T+60d Outcome</th>
                <th className="py-3 px-6">Observed Metric Traction</th>
                <th className="py-3 px-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {episodes.map((ep: any) => (
                <tr key={ep.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-4 px-6 font-medium text-slate-900">
                    <Link
                      href={`/opportunities/${ep.opportunity_slug}`}
                      className="hover:text-blue-600 flex items-center gap-1.5"
                    >
                      <span>{ep.opportunity_title}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                    </Link>
                  </td>
                  <td className="py-4 px-6">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        ep.published_verdict === 'BUILD_NOW'
                          ? 'bg-emerald-100 text-emerald-800'
                          : ep.published_verdict === 'EARLY_BET'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {ep.published_verdict}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-slate-500 font-mono text-xs">
                    {formatDate(ep.predicted_at)}
                  </td>
                  <td className="py-4 px-6">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold ${
                        ep.outcome_30d === 'HIT'
                          ? 'bg-emerald-50 text-emerald-700'
                          : ep.outcome_30d === 'MISS'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {ep.outcome_30d === 'HIT' && <CheckCircle2 className="w-3 h-3" />}
                      {ep.outcome_30d}
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold ${
                        ep.outcome_60d === 'HIT'
                          ? 'bg-emerald-50 text-emerald-700'
                          : ep.outcome_60d === 'MISS'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {ep.outcome_60d === 'HIT' && <CheckCircle2 className="w-3 h-3" />}
                      {ep.outcome_60d || 'PENDING'}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-xs text-slate-600 font-mono">
                    {ep.metrics?.cluster_expansion
                      ? `+${((ep.metrics.cluster_expansion - 1) * 100).toFixed(0)}% cluster expansion`
                      : ep.metrics?.window_closed
                      ? 'Window closed by 3 entrants'
                      : 'Accumulating signals'}
                  </td>
                  <td className="py-4 px-6 text-right">
                    <Link
                      href={`/opportunities/${ep.opportunity_slug}`}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                    >
                      Inspect
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Merkle Checkpoints Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Daily Merkle Checkpoints & Proofs
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Daily SHA-256 Merkle root hashes published per RFC 6962 specification
            </p>
          </div>
          <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
            SHA-256 Hash Chain Active
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {checkpoints.map((ckp: any) => (
            <div key={ckp.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-900 font-mono">
                    {formatDate(ckp.obs_date)}
                  </span>
                  <span className="text-xs text-slate-500">
                    ({ckp.total_records} opportunities sealed)
                  </span>
                </div>

                <div className="mt-2 text-xs font-mono text-slate-600 break-all bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="text-slate-400 select-none">Merkle Root: </span>
                  <strong className="text-blue-700">{ckp.merkle_root}</strong>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <Link
                  href={`/api/v1/public/verify-ledger?date=${formatDate(ckp.obs_date)}`}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Verify JSON Proof</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
