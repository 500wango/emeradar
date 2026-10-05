import { getAdminSession } from '@/lib/admin-auth';
import { notFound } from 'next/navigation';
import { AdminService } from '@emeradar/services';
import { UsersClient } from '@/components/admin/UsersClient';

export default async function AdminUsersPage() {
  const session = await getAdminSession();
  if (!session) {
    notFound();
  }

  const { items, total, stats } = await AdminService.listUsers({ limit: 50 });

  return <UsersClient initialItems={items} initialTotal={total} initialStats={stats} />;
}
