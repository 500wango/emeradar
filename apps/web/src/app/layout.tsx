import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { EvidenceDrawer } from '@/components/EvidenceDrawer';
import { AuthProvider } from '@/lib/auth-context';
import { I18nProvider } from '@/lib/i18n';
import { getServerLocale } from '@/lib/i18n/server';

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
    <html lang={locale === 'zh-CN' ? 'zh-CN' : 'en'}>
      <body className="min-h-screen flex flex-col bg-slate-50 text-slate-900 antialiased">
        <AuthProvider>
          <I18nProvider initialLocale={locale}>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
            >
              {locale === 'zh-CN' ? '跳到主要内容' : 'Skip to main content'}
            </a>
            <Navbar />
            <main id="main-content" className="flex-1">{children}</main>
            <Footer />
            <EvidenceDrawer />
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
