import { cookies } from 'next/headers';
import { AuthService, EntitlementService } from '@emeradar/services';
import { PricingClient } from '@/components/PricingClient';
import { JsonLd } from '@/components/seo/JsonLd';
import { getServerI18n } from '@/lib/i18n/server';
import { breadcrumbJsonLd, faqPageJsonLd, pageMetadata } from '@/lib/seo/site';

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
  const { dict, isZh } = await getServerI18n();

  const faqs = (dict.pricing?.faqs || []).map((faq: { q: string; a: string }) => ({
    question: faq.q,
    answer: faq.a,
  }));

  const breadcrumbs = breadcrumbJsonLd([
    { name: isZh ? '首页' : 'Home', path: '/' },
    { name: isZh ? '价格方案' : 'Pricing', path: '/pricing' },
  ]);

  return (
    <>
      <JsonLd data={[breadcrumbs, faqPageJsonLd(faqs)]} />
      <PricingClient
        entitlements={entitlements}
        isLoggedIn={!!session}
      />
    </>
  );
}
