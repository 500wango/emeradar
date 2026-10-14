import Link from 'next/link';
import { getServerI18n } from '@/lib/i18n/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo/site';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';

const SECTIONS = [
  ['privacy.collectionTitle', 'privacy.collectionBody'],
  ['privacy.noSellTitle', 'privacy.noSellBody'],
  ['privacy.identifiersTitle', 'privacy.identifiersBody'],
  ['privacy.rightsTitle', 'privacy.rightsBody'],
  ['privacy.contactTitle', 'privacy.contactBody'],
] as const;

export async function generateMetadata() {
  const { locale, t } = await getServerI18n();
  return pageMetadata({
    title: t('seo.privacy.title'),
    description: t('seo.privacy.description'),
    path: '/privacy',
    locale,
  });
}

export default async function PrivacyPage() {
  const { t, isZh } = await getServerI18n();

  const breadcrumbs = breadcrumbJsonLd([
    { name: isZh ? '首页' : 'Home', path: '/' },
    { name: isZh ? '隐私政策' : 'Privacy Policy', path: '/privacy' },
  ]);

  return (
    <>
      <JsonLd data={breadcrumbs} />
      <PageFrame width="prose">
        <PageHeader
          eyebrow="PRIVACY"
          title={t('privacy.title')}
          lede={t('privacy.intro')}
        />

        <div className="mt-12 space-y-10">
          {SECTIONS.map(([title, body], index) => (
            <section key={title}>
              <h2 className="flex gap-4 font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
                <span className="text-fg-subtle">{String(index + 1).padStart(2, '0')}</span>
                {t(title)}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-fg-muted">{t(body)}</p>
            </section>
          ))}
        </div>

        <p className="mt-12 border-t border-line pt-8">
          <Link
            href="/terms"
            className="font-mono text-xs text-accent transition-colors hover:brightness-110"
          >
            {isZh ? '← 查看服务条款' : '← View Terms of Service'}
          </Link>
        </p>
      </PageFrame>
    </>
  );
}
