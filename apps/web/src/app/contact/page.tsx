import Link from 'next/link';
import { getServerI18n } from '@/lib/i18n/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbJsonLd, contactPageJsonLd, pageMetadata } from '@/lib/seo/site';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';
import { Mail, ShieldAlert, KeyRound, Github, Clock, ArrowRight } from 'lucide-react';

export async function generateMetadata() {
  const { locale, t } = await getServerI18n();
  return pageMetadata({
    title: t('seo.contact.title'),
    description: t('seo.contact.description'),
    path: '/contact',
    locale,
  });
}

export default async function ContactPage() {
  const { t, isZh } = await getServerI18n();

  const breadcrumbs = breadcrumbJsonLd([
    { name: isZh ? '首页' : 'Home', path: '/' },
    { name: isZh ? '联系我们' : 'Contact', path: '/contact' },
  ]);

  const contactSchema = contactPageJsonLd();

  const channels = [
    {
      icon: Mail,
      title: t('contact.supportTitle'),
      desc: t('contact.supportDesc'),
      actionLabel: 'support@emeradar.com',
      actionHref: 'mailto:support@emeradar.com',
    },
    {
      icon: ShieldAlert,
      title: t('contact.securityTitle'),
      desc: t('contact.securityDesc'),
      actionLabel: 'security@emeradar.com',
      actionHref: 'mailto:security@emeradar.com',
    },
    {
      icon: KeyRound,
      title: t('contact.licensingTitle'),
      desc: t('contact.licensingDesc'),
      actionLabel: 'licensing@emeradar.com',
      actionHref: 'mailto:licensing@emeradar.com',
    },
    {
      icon: Github,
      title: t('contact.communityTitle'),
      desc: t('contact.communityDesc'),
      actionLabel: 'github.com/500wango/emeradar',
      actionHref: 'https://github.com/500wango/emeradar',
      external: true,
    },
  ];

  return (
    <>
      <JsonLd data={breadcrumbs} />
      <JsonLd data={contactSchema} />
      <PageFrame width="prose">
        <PageHeader
          eyebrow="CONTACT & SUPPORT"
          title={t('contact.title')}
          lede={t('contact.intro')}
        />

        {/* Operating SLA */}
        <div className="mt-6 flex items-center gap-2 border-b border-line pb-6 font-mono text-xs text-fg-subtle">
          <Clock className="h-4 w-4 text-accent" />
          <span>{t('contact.responseTimeNote')}</span>
        </div>

        {/* Contact channels grid */}
        <div className="mt-10 grid gap-6">
          {channels.map((ch) => {
            const Icon = ch.icon;
            return (
              <div
                key={ch.actionLabel}
                className="rounded-lg border border-line bg-surface p-6 transition-colors hover:border-line-hover"
              >
                <div className="flex items-center gap-3 text-accent">
                  <Icon className="h-5 w-5" />
                  <h2 className="font-mono text-xs uppercase tracking-wider text-fg">
                    {ch.title}
                  </h2>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-fg-muted">{ch.desc}</p>
                <div className="mt-4">
                  <a
                    href={ch.actionHref}
                    target={ch.external ? '_blank' : undefined}
                    rel={ch.external ? 'noopener noreferrer' : undefined}
                    className="inline-flex items-center gap-1.5 font-mono text-xs text-accent transition-colors hover:brightness-110"
                  >
                    <span>{ch.actionLabel}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer link back to about */}
        <p className="mt-12 border-t border-line pt-8">
          <Link
            href="/about"
            className="font-mono text-xs text-accent transition-colors hover:brightness-110"
          >
            ← {isZh ? '关于 Emeradar' : 'About Emeradar'}
          </Link>
        </p>
      </PageFrame>
    </>
  );
}
