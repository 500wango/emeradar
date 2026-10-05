import { getAdminSession } from '@/lib/admin-auth';
import { notFound } from 'next/navigation';
import { AdminService } from '@emeradar/services';
import { PipelineOpsClient } from '@/components/admin/PipelineOpsClient';

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) {
    notFound();
  }

  const overview = await AdminService.getPipelineOverview();

  return <PipelineOpsClient initialOverview={overview} />;
}
