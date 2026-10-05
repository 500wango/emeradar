import { getAdminSession } from '@/lib/admin-auth';
import { notFound } from 'next/navigation';
import { AdminService } from '@emeradar/services';
import { CandidatesClient } from '@/components/admin/CandidatesClient';

export default async function AdminCandidatesPage() {
  const session = await getAdminSession();
  if (!session) {
    notFound();
  }

  const { items, total } = await AdminService.listCandidates({ limit: 50 });

  return <CandidatesClient initialItems={items} total={total} />;
}
