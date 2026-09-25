import { notFound } from 'next/navigation';
import { OpportunityService, ReportService } from '@emeradar/services';
import { ReportStudioClient } from '@/components/ReportStudioClient';

interface ReportPageProps {
  params: Promise<{ slug: string }>;
}

export default async function OpportunityReportPage({ params }: ReportPageProps) {
  const { slug } = await params;

  let detail: any;
  try {
    detail = await OpportunityService.getOpportunityDetail(slug);
  } catch {
    notFound();
  }

  // Use demo Pro user for web preview
  const userId = 'usr_demo_pro';

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
