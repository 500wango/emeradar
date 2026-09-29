import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService, OpportunityService, ReportService } from '@emeradar/services';
import { ReportStudioClient } from '@/components/ReportStudioClient';

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

  const report = await ReportService.getOrGenerateReport(
    detail.opportunity.id,
    userId,
    'en-US'
  );

  return (
    <ReportStudioClient
      reportId={report.reportId}
      data={report.data}
      markdown={report.markdown}
      opportunitySlug={slug}
    />
  );
}
