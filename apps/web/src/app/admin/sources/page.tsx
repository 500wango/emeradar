import { getAdminSession } from '@/lib/admin-auth';
import { notFound } from 'next/navigation';
import { AdminService } from '@emeradar/services';
import { SourcesClient } from '@/components/admin/SourcesClient';

export default async function AdminSourcesPage() {
  const session = await getAdminSession();
  if (!session) {
    notFound();
  }

  const sources = await AdminService.listSources();

  return <SourcesClient initialSources={sources} />;
}
