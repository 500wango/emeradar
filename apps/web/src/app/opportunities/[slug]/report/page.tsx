import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Lock, Sparkles } from 'lucide-react';
import { AuthService, EntitlementService, OpportunityService, ReportService, freeAccessibleOpportunityId } from '@emeradar/services';
import { ReportStudioClient } from '@/components/ReportStudioClient';
import { getServerI18n } from '@/lib/i18n/server';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { buttonVariants } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { PageFrame } from '@/components/ui/PageFrame';

interface ReportPageProps {
  params: Promise<{ slug: string }>;
}

/** Shared shape of the two centred notice states (quota / evidence gate). */
function noticeIcon(tone: 'warn' | 'accent') {
  return cn(
    'mx-auto mb-5 flex h-14 w-14 items-center justify-center border',
    tone === 'warn' ? 'border-warn/40 bg-warn/10 text-warn' : 'border-accent/40 bg-accent/10 text-accent'
  );
}

export default async function OpportunityReportPage({ params }: ReportPageProps) {
  const { slug } = await params;

  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect(`/login?next=${encodeURIComponent(`/opportunities/${slug}/report`)}`);
  const userId = session.user.id;

  // Aligned with the opportunity detail page (`opportunities/[slug]/page.tsx`):
  // the workspace and its report share the exact same gate. FREE users reach only
  // this week's selected case (13 §3.2「每月 1 份历史案例报告预览」), and its
  // generation still spends the free monthly report quota inside ReportService.
  const ent = await EntitlementService.getUserEntitlements(session.user.id);
  const weeklyId = ent.opportunityDetailFull ? null : await freeAccessibleOpportunityId(slug);
  if (!ent.opportunityDetailFull && !weeklyId) redirect('/pricing?feature=opportunity-detail');

  let detail: any;
  try {
    detail = await OpportunityService.getOpportunityDetail(slug, {
      // 精选案例按定义是准实时的，不再套 45 天延迟；其余路径保持原过滤。
      minAgeDays: weeklyId ? 0 : ent.feedDelayDays,
      viewerId: session.user.id,
    });
  } catch {
    notFound();
  }

  const { t, locale } = await getServerI18n();

  if (!session.user.emailVerifiedAt) {
    return (
      <PageFrame width="prose">
        <Panel className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center border border-warn/40 bg-warn/10 text-warn">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="font-display text-xl font-bold text-fg">{t('reportGate.verifyTitle')}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">
            {t('reportGate.verifyDesc')}
          </p>
          <Link href="/settings" className={cn(buttonVariants({ size: 'md' }), 'mt-6')}>
            <span>{t('auth.openSettings')}</span>
            <ArrowLeft className="h-4 w-4 rotate-180" />
          </Link>
        </Panel>
      </PageFrame>
    );
  }

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
        <PageFrame width="prose">
          <Panel className="p-8 text-center sm:p-10">
            <div className={noticeIcon('warn')}>
              <Lock className="h-7 w-7" />
            </div>

            <Badge tone="warn">FREE TRIAL &middot; 1/1</Badge>

            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-fg">
              {t('reportGate.quotaTitle')}
            </h1>

            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-fg-muted">
              {t('reportGate.quotaDesc', { title: detail.opportunity.title })}
            </p>

            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={`/pricing?reason=quota_exceeded&feature=report&back=${encodeURIComponent(`/opportunities/${slug}`)}`}
                className={cn(buttonVariants({ size: 'md' }), 'w-full sm:w-auto')}
              >
                <Sparkles className="h-4 w-4" />
                <span>{t('reportGate.upgradeCta')}</span>
              </Link>
              <Link
                href={`/opportunities/${slug}`}
                className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'w-full sm:w-auto')}
              >
                <ArrowLeft className="h-4 w-4" />
                <span>{t('reportGate.backToOpportunity')}</span>
              </Link>
            </div>
          </Panel>
        </PageFrame>
      );
    }

    if (err.code === 'PRECONDITION_FAILED' || err.status === 409) {
      console.error(`[OpportunityReportPage] Evidence gate not met for ${slug}:`, err?.detail || err?.message || err);
      return (
        <PageFrame width="prose">
          <Panel className="p-8 text-center sm:p-10">
            <div className={noticeIcon('accent')}>
              <Sparkles className="h-7 w-7" />
            </div>

            <Badge tone="accent">EVIDENCE GATE NOT MET</Badge>

            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-fg">
              {t('reportGate.evidenceTitle')}
            </h1>

            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-fg-muted">
              {t('reportGate.evidenceDesc')}
            </p>

            <div className="mt-6 flex justify-center">
              <Link
                href={`/opportunities/${slug}`}
                className={buttonVariants({ variant: 'outline', size: 'md' })}
              >
                <ArrowLeft className="h-4 w-4" />
                <span>{t('reportGate.backToOpportunity')}</span>
              </Link>
            </div>
          </Panel>
        </PageFrame>
      );
    }

    console.error(`[OpportunityReportPage] Report unavailable for ${slug}:`, err?.message || err);

    return (
      <PageFrame width="prose">
        <Panel className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center border border-warn/40 bg-warn/10 text-warn">
            <Clock className="h-6 w-6" />
          </div>
          <h1 className="font-display text-xl font-bold text-fg">{t('reportGate.errorTitle')}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">
            {t('reportGate.errorDesc')}
          </p>
          <div className="mt-6 flex justify-center">
            <Link
              href={`/opportunities/${slug}`}
              className={cn(buttonVariants({ variant: 'secondary', size: 'md' }))}
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{t('reportGate.backToOpportunity')}</span>
            </Link>
          </div>
        </Panel>
      </PageFrame>
    );
  }

  return (
    <ReportStudioClient
      reportId={report.reportId}
      data={report.data}
      markdown={report.markdown}
      opportunitySlug={slug}
      bands={{
        d: detail.opportunity.d_band ?? 'INSUFFICIENT',
        m: detail.opportunity.m_band ?? 'INSUFFICIENT',
        w: detail.opportunity.w_band ?? 'INSUFFICIENT',
      }}
    />
  );
}
