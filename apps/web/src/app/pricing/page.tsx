import { cookies } from 'next/headers';
import { AuthService, EntitlementService } from '@emeradar/services';
import { PricingClient } from '@/components/PricingClient';
import { getServerI18n } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo/site';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const { locale, t } = await getServerI18n();
  return pageMetadata({
    title: t('seo.pricing.title'),
    description: t('seo.pricing.description'),
    path: '/pricing',
    locale,
  });
}

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
