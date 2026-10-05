import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock } from 'lucide-react';
import { AuthService, OpportunityService, ReportService } from '@emeradar/services';
import { ReportStudioClient } from '@/components/ReportStudioClient';
import { getServerLocale } from '@/lib/i18n/server';

interface ReportPageProps {
  params: Promise<{ slug: string }>;
}

export default async function OpportunityReportPage({ params }: ReportPageProps) {
  const { slug } = await params;

  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect(`/login?next=${encodeURIComponent(`/opportunities/${slug}/report`)}`);
  const userId = session.user.id;

  let detail: any;
  try {
    detail = await OpportunityService.getOpportunityDetail(slug);
  } catch {
    notFound();
  }

  const locale = await getServerLocale();
  const isZh = locale === 'zh-CN';

  let report: any;
  try {
    report = await ReportService.getOrGenerateReport(
      detail.opportunity.id,
      userId,
      locale
    );
  } catch (err: any) {
    if (err.code === 'QUOTA_EXCEEDED' || err.status === 429) {
      redirect(`/pricing?reason=quota_exceeded&feature=report&back=${encodeURIComponent(`/opportunities/${slug}`)}`);
    }

    console.error(`[OpportunityReportPage] Report unavailable for ${slug}:`, err?.message || err);

    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm text-center">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Clock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            {isZh ? '深度研究报告暂未开放' : 'Research Report Not Yet Available'}
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto mb-6 leading-relaxed">
            {err.detail || err.message || (isZh
              ? '该机会目前处于候选孵化或初始观察阶段，系统尚未完成 14 天完整搜索与商业信号沉淀。完整六章节研究报告仅对正式发布的 BUILD NOW 或 EARLY BET 决策开放。'
              : 'This opportunity is currently in observation. Full research reports are exported only after a published BUILD NOW or EARLY BET verdict.')}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href={`/opportunities/${slug}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm font-semibold transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{isZh ? '返回机会看板' : 'Back to Opportunity'}</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ReportStudioClient
      reportId={report.reportId}
      data={report.data}
      markdown={report.markdown}
      opportunitySlug={slug}
    />
  );
}
