import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService, EntitlementService } from '@emeradar/services';
import { PricingClient } from '@/components/PricingClient';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login?next=%2Fbilling');
  if (session.user.role === 'ADMIN') redirect('/admin');
  const userId = session.user.id;
  const ent = await EntitlementService.getUserEntitlements(userId);

  return (
    <PricingClient
      entitlements={ent}
      isLoggedIn={true}
    />
  );
}
