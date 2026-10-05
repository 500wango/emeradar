import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Lock, Sparkles } from 'lucide-react';
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
      return (
        <div className="max-w-2xl mx-auto px-4 py-16">
          <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-lg text-center relative overflow-hidden">
            <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-xs">
              <Lock className="w-7 h-7" />
            </div>

            <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-amber-100/70 text-amber-800 mb-3">
              {isZh ? '免费体验额度已用尽 (1/1)' : 'Free Trial Quota Reached (1/1)'}
            </span>

            <h2 className="text-2xl font-black text-slate-900 mb-3 tracking-tight">
              {isZh ? '解锁全量商业机会深度研报' : 'Unlock Full Research Reports'}
            </h2>

            <p className="text-sm text-slate-600 max-w-md mx-auto mb-8 leading-relaxed">
              {isZh
                ? `您已体验过 1 份完整商业机会研报。当前商业机会「${detail.opportunity.title}」包含六大章节研报（市场规模估算、Top 10 弱站穿透分析、真实结账证据、MVP 单周落地架构与止损准则）。升级至 Builder Pro 每月可解锁 30 份深度研报。`
                : `You have reached your 1 free monthly report limit. Upgrade to Builder Pro to unlock 30 in-depth opportunity reports per month.`}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href={`/pricing?reason=quota_exceeded&feature=report&back=${encodeURIComponent(`/opportunities/${slug}`)}`}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-md shadow-blue-500/20 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isZh ? '升级至 Builder Pro ($49/月)' : 'Upgrade to Builder Pro'}</span>
              </Link>
              <Link
                href={`/opportunities/${slug}`}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{isZh ? '返回机会看板' : 'Back to Opportunity'}</span>
              </Link>
            </div>
          </div>
        </div>
      );
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
