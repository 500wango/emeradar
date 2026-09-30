import { cookies } from 'next/headers';
import { AuthService, EntitlementService } from '@emeradar/services';
import { PricingClient } from '@/components/PricingClient';

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  const entitlements = session ? await EntitlementService.getUserEntitlements(session.user.id) : null;

  return (
    <PricingClient
      entitlements={entitlements}
      isLoggedIn={!!session}
    />
  );
}
