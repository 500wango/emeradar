import Link from 'next/link';
import { getServerI18n } from '@/lib/i18n/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { aboutPageJsonLd, breadcrumbJsonLd, pageMetadata } from '@/lib/seo/site';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';
import { ShieldCheck, Database, Award, GitBranch, ArrowRight } from 'lucide-react';

export async function generateMetadata() {
  const { locale, t } = await getServerI18n();
  return pageMetadata({
    title: t('seo.about.title'),
    description: t('seo.about.description'),
    path: '/about',
    locale,
  });
}

export default async function AboutPage() {
  const { t, isZh } = await getServerI18n();

  const breadcrumbs = breadcrumbJsonLd([
    { name: isZh ? '首页' : 'Home', path: '/' },
    { name: isZh ? '关于我们' : 'About', path: '/about' },
  ]);

  const aboutSchema = aboutPageJsonLd();

  return (
    <>
      <JsonLd data={breadcrumbs} />
      <JsonLd data={aboutSchema} />
      <PageFrame width="prose">
        <PageHeader
          eyebrow="ABOUT EMERADAR"
          title={t('about.title')}
          lede={t('about.intro')}
        />

        {/* Byline & Freshness */}
        <div className="mt-6 flex flex-wrap items-center gap-4 border-b border-line pb-6 font-mono text-xs text-fg-subtle">
          <span className="inline-flex items-center gap-1.5 text-accent">
            <ShieldCheck className="h-4 w-4" />
            <span>{t('about.byline')}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {isZh ? '更新于 ' : 'Updated '}
            <time dateTime="2026-10-14T23:00:00Z">2026-10-14</time>
          </span>
        </div>

        {/* Core sections */}
        <div className="mt-10 space-y-12">
          <section>
            <div className="flex items-center gap-3 text-accent">
              <Award className="h-5 w-5" />
              <h2 className="font-mono text-xs uppercase tracking-wider text-fg">
                {t('about.missionTitle')}
              </h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">
              {t('about.missionDesc')}
            </p>
          </section>

          <section>
            <div className="flex items-center gap-3 text-accent">
              <Database className="h-5 w-5" />
              <h2 className="font-mono text-xs uppercase tracking-wider text-fg">
                {t('about.principlesTitle')}
              </h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">
              {t('about.principlesDesc')}
            </p>
          </section>

          {/* Citations & Evidence Standards (AI Overviews Citation Engine) */}
          <section className="rounded-lg border border-line bg-surface p-6">
            <figure className="border-l-2 border-accent pl-4">
              <blockquote
                cite="https://developers.google.com/search/docs/fundamentals/creating-helpful-content"
                className="text-sm italic leading-relaxed text-fg-muted"
              >
                &ldquo;Creating helpful, reliable, people-first content means providing original information, reporting, research, or analysis, with clear source attribution.&rdquo;
              </blockquote>
              <figcaption className="mt-2 font-mono text-xs not-italic text-fg-subtle">
                — <cite><a href="https://developers.google.com/search/docs/fundamentals/creating-helpful-content" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">Google Search Central Documentation</a></cite>
              </figcaption>
            </figure>
          </section>

          <section>
            <div className="flex items-center gap-3 text-accent">
              <GitBranch className="h-5 w-5" />
              <h2 className="font-mono text-xs uppercase tracking-wider text-fg">
                {t('about.teamTitle')}
              </h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">
              {t('about.teamDesc')}
            </p>
          </section>

          <section>
            <h2 className="font-mono text-xs uppercase tracking-wider text-fg">
              {t('about.dataIntegrityTitle')}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">
              {t('about.dataIntegrityDesc')}
            </p>
            <ul className="mt-4 space-y-2 font-mono text-xs text-fg-subtle">
              <li className="flex items-center gap-2">
                <span className="text-accent">▸</span> Google Autocomplete APIs &amp; Expansion Frequency
              </li>
              <li className="flex items-center gap-2">
                <span className="text-accent">▸</span> Serper Organic SERP Top 10 Structure Analysis
              </li>
              <li className="flex items-center gap-2">
                <span className="text-accent">▸</span> Public Commercial Checkout &amp; Pricing Directory Sampling
              </li>
            </ul>
          </section>
        </div>

        {/* Quick Links */}
        <div className="mt-12 flex flex-wrap items-center gap-6 border-t border-line pt-8 font-mono text-xs text-fg-subtle">
          <Link
            href="/methodology"
            className="inline-flex items-center gap-1.5 text-accent transition-colors hover:brightness-110"
          >
            {isZh ? '了解实证方法论' : 'Explore Methodology'} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-accent"
          >
            {isZh ? '联系我们' : 'Contact Us'} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <a
            href="https://github.com/500wango/emeradar"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-accent"
          >
            GitHub Repository ↗
          </a>
        </div>
      </PageFrame>
    </>
  );
}
