import type { Metadata } from 'next';
import './globals.css';
import { SiteChrome } from '@/components/SiteChrome';
import { EvidenceDrawer } from '@/components/EvidenceDrawer';
import { GrainOverlay } from '@/components/observatory/GrainOverlay';
import { AuthProvider } from '@/lib/auth-context';
import { I18nProvider } from '@/lib/i18n';
import { getServerLocale } from '@/lib/i18n/server';
import { fontVariables } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'Emeradar | Search Opportunity Intelligence & Commercial Radar for Builders',
  description:
    'Discover validated search demand, addressable SERP weakness, and verifiable commercial signals. Turn organic search momentum into profitable micro-SaaS products.',
  icons: {
    icon: '/icon.svg',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getServerLocale();

  return (
    <html lang={locale === 'zh-CN' ? 'zh-CN' : 'en'} className={fontVariables}>
      <body className="min-h-screen flex flex-col bg-canvas text-fg antialiased">
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
