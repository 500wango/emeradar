import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  FolderKanban,
  ExternalLink,
  Plus,
  MousePointerClick,
  Eye,
} from 'lucide-react';
import { AuthService, ProjectService } from '@emeradar/services';
import { formatDate } from '@/lib/format';

export default async function ProjectsPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login');
  const userId = session.user.id;
  const projects = await ProjectService.listUserProjects(userId);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5 text-indigo-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
              Builder Traction Hub
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
            My Tracked Projects
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Monitor real-world SEO traction, GSC impressions, and conversion outcomes against opportunity predictions.
          </p>
        </div>

        <Link
          href="/feed"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Launch from Opportunity</span>
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-lg mx-auto">
          <FolderKanban className="w-12 h-12 text-slate-400 mx-auto mb-4" />
          <h3 className="text-base font-bold text-slate-900">No active projects yet</h3>
          <p className="text-xs text-slate-500 mt-2">
            Pick a BUILD NOW opportunity from the Radar feed to initiate your first tracked micro-SaaS project.
          </p>
          <Link
            href="/feed"
            className="mt-6 inline-block px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold"
          >
            Browse Opportunities
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {projects.map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        p.status === 'LAUNCHED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {p.status}
                    </span>
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      {p.build_type}
                    </span>
                    <span className="text-xs text-slate-400">&bull;</span>
                    <span className="text-xs text-slate-500">
                      Launched: {p.launch_date ? formatDate(p.launch_date) : 'In Dev'}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-slate-900"><Link href={`/projects/${p.id}`} className="hover:text-blue-600">{p.title}</Link></h3>

                  {p.domain && (
                    <div className="mt-1 flex items-center gap-2 text-xs text-blue-600">
                      <a
                        href={`https://${p.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline flex items-center gap-1 font-mono"
                      >
                        <span>{p.domain}</span>
                        <ExternalLink className="w-3 h-3 text-slate-400" />
                      </a>
                    </div>
                  )}

                  <div className="mt-2 text-xs text-slate-500">
                    Linked Opportunity:{' '}
                    <Link
                      href={`/opportunities/${p.opportunity_slug}`}
                      className="font-medium text-slate-800 hover:text-blue-600 underline"
                    >
                      {p.opportunity_title}
                    </Link>
                  </div>
                </div>

                {/* GSC Traction Highlights */}
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 shrink-0">
                  <div className="text-center px-3 border-r border-slate-200">
                    <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 uppercase">
                      <Eye className="w-3 h-3 text-blue-500" />
                      <span>GSC Impressions</span>
                    </div>
                    <div className="text-xl font-bold text-slate-900 mt-1">
                      {p.total_impressions.toLocaleString()}
                    </div>
                  </div>

                  <div className="text-center px-3">
                    <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 uppercase">
                      <MousePointerClick className="w-3 h-3 text-emerald-500" />
                      <span>Organic Clicks</span>
                    </div>
                    <div className="text-xl font-bold text-emerald-600 mt-1">
                      {p.total_clicks.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Target Keywords */}
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500 font-semibold mr-1">
                  Target Search Keywords:
                </span>
                {p.target_keywords?.map((kw: string, i: number) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-md text-xs font-mono bg-slate-100 text-slate-700 border border-slate-200"
                  >
                    {kw}
                  </span>
                ))}
                  </div>
                </div>
          ))}
        </div>
      )}
    </div>
  );
}
