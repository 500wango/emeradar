import type { Metadata } from 'next';
import './globals.css';
import { SiteChrome } from '@/components/SiteChrome';
import { EvidenceDrawer } from '@/components/EvidenceDrawer';
import { GrainOverlay } from '@/components/observatory/GrainOverlay';
import { JsonLd } from '@/components/seo/JsonLd';
import { AuthProvider } from '@/lib/auth-context';
import { I18nProvider } from '@/lib/i18n';
import { getServerI18n } from '@/lib/i18n/server';
import { fontVariables } from '@/lib/fonts';
import { ROBOTS_INDEX, SITE_NAME, SITE_URL, absoluteUrl, organizationJsonLd, websiteJsonLd } from '@/lib/seo/site';

// CSP nonces are per request; HTML must never be prerendered with a stale nonce.
export const dynamic = 'force-dynamic';

/**
 * 站点默认 metadata。标题与描述按**服务端实际渲染的语言**给：爬虫不带 cookie
 * （Googlebot 也不带 Accept-Language），它看到的那一版就是这里的 locale，
 * 让 <title> 与页面正文同语言，比让搜索引擎按正文重写标题更可控。
 */
export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getServerI18n();
  const title = t('seo.home.title');
  const description = t('seo.home.description');
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: title,
      // 子页面只写自己的名字，品牌由模板补：同一句话不会在两处各写一遍。
      template: `%s · ${SITE_NAME}`,
    },
    description,
    icons: { icon: '/icon.svg' },
    robots: ROBOTS_INDEX,
    alternates: { canonical: absoluteUrl('/') },
    openGraph: {
      type: 'website',
      url: absoluteUrl('/'),
      siteName: SITE_NAME,
      title,
      description,
      locale: locale === 'zh-CN' ? 'zh_CN' : 'en_US',
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale } = await getServerI18n();

  return (
    <html lang={locale === 'zh-CN' ? 'zh-CN' : 'en'} className={fontVariables}>
      <body className="min-h-screen flex flex-col bg-canvas text-fg antialiased">
        {/* 站点级实体（Organization / WebSite）：告诉搜索引擎这个域是谁、叫什么。 */}
        <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
        <AuthProvider>
          <I18nProvider initialLocale={locale}>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-solid focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-solid-fg"
            >
              {locale === 'zh-CN' ? '跳到主要内容' : 'Skip to main content'}
            </a>
            <GrainOverlay />
            <SiteChrome>{children}</SiteChrome>
            <EvidenceDrawer />
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
