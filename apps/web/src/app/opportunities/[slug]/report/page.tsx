import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
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
    throw err;
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
