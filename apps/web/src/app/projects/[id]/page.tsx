import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { AuthService, ProjectService } from '@emeradar/services';
import SiteCheckButton from '@/components/SiteCheckButton';
import { getServerI18n } from '@/lib/i18n/server';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login');
  const { id } = await params;
  let data: any;
  try { data = await ProjectService.getProjectDetail(id, session.user.id); } catch { notFound(); }
  const { t } = await getServerI18n();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/projects" className="text-sm text-slate-500 hover:text-slate-800">
        &larr; {t('projects.backToProjects')}
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">{data.project.title}</h1>
      <p className="mt-1 text-sm text-slate-500">{data.project.domain || t('projects.noDomain')}</p>
      {data.project.domain && <SiteCheckButton projectId={id} />}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {data.outcomes.map((outcome: any) => (
          <section key={outcome.day} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-500">T+{outcome.day}</div>
            <div className="mt-2 text-lg font-bold text-slate-900">
              {outcome.status === 'PENDING' ? t('projects.pending') : outcome.clicks.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {outcome.status === 'PENDING'
                ? t('projects.awaitingGsc')
                : t('projects.impressionsQueries', {
                    impressions: outcome.impressions.toLocaleString(),
                    queries: outcome.queries,
                  })}
            </div>
          </section>
        ))}
      </div>
      <h2 className="mt-10 text-base font-semibold text-slate-900">{t('projects.weeklyData')}</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="p-3">{t('projects.colWeek')}</th>
              <th className="p-3">{t('projects.colImpressions')}</th>
              <th className="p-3">{t('projects.colClicks')}</th>
              <th className="p-3">{t('projects.colPosition')}</th>
            </tr>
          </thead>
          <tbody>
            {data.metrics.map((row: any) => (
              <tr key={row.week_start_date} className="border-b border-slate-100">
                <td className="p-3">{row.week_start_date}</td>
                <td className="p-3">{row.impressions}</td>
                <td className="p-3">{row.clicks}</td>
                <td className="p-3">{row.average_position}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
