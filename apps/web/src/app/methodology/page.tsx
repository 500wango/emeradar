import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { getServerI18n } from '@/lib/i18n/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbJsonLd, pageMetadata, techArticleJsonLd } from '@/lib/seo/site';
import { buttonVariants } from '@/components/ui/Button';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { AxisBands } from '@/components/observatory/AxisBands';

export async function generateMetadata() {
  const { locale, t } = await getServerI18n();
  return pageMetadata({
    title: t('seo.methodology.title'),
    description: t('seo.methodology.description'),
    path: '/methodology',
    locale,
  });
}

/**
 * The methodology page is the document the rest of the product cites whenever
 * something is withheld ("no BUILD NOW cleared the gate — see how the gate
 * works"). So it is written as a specification, not as marketing: numbered
 * sections, the gate conditions verbatim, and the band legend itself.
 */
export default async function MethodologyPage() {
  const { t, locale, isZh } = await getServerI18n();

  const steps = [
    t('methodology.step1'),
    t('methodology.step2'),
    t('methodology.step3'),
    t('methodology.step4'),
    t('methodology.step5'),
  ];

  const gates = [
    t('methodology.gateItem1'),
    t('methodology.gateItem2'),
    t('methodology.gateItem3'),
    t('methodology.gateItem4'),
  ];

  const claims = [
    t('methodology.claimItem1'),
    t('methodology.claimItem2'),
    t('methodology.claimItem3'),
    t('methodology.claimItem4'),
  ];

  const breadcrumbs = breadcrumbJsonLd([
    { name: isZh ? '首页' : 'Home', path: '/' },
    { name: isZh ? '三维实证方法论' : 'Methodology', path: '/methodology' },
  ]);

  const articleSchema = techArticleJsonLd({
    headline: t('seo.methodology.title'),
    description: t('seo.methodology.description'),
    path: '/methodology',
    locale,
    articleSection: [
      t('methodology.lifecycleTitle'),
      t('methodology.gateTitle'),
      t('methodology.bandsTitle'),
      t('methodology.claimsTitle'),
    ],
  });

  return (
    <>
      <JsonLd data={[breadcrumbs, articleSchema]} />
      <PageFrame width="prose">
        <PageHeader eyebrow="METHODOLOGY" title={t('methodology.title')} lede={t('methodology.intro')} />

        {/* Direct Answer & Core Definition for Generative Engine / AI Overviews extraction */}
        <section aria-labelledby="methodology-executive-summary" className="mt-8">
          <Panel tone="raised" brackets className="p-6 sm:p-7">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span id="methodology-executive-summary">
                {isZh ? '三维实证门槛核心公理 · 摘要' : 'Core Evaluation Axioms · Executive Summary'}
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-fg">
              {isZh
                ? 'Emeradar 采用严格的三维实证准入体系（D 轴需求势能、M 轴付费证据、W 轴竞争弱点窗口），在写代码前对搜索机会做可复核的真伪验证。仅当三轴全部满足门槛且具备连续样本时，系统方可裁决为 BUILD NOW；任何维度证据不充分均强制留空。'
                : 'Emeradar applies an empirical 3-axis gating framework (D-Axis Demand Formation, M-Axis Commercial Proof, and W-Axis SERP Vulnerability Window) to audit search opportunities before writing code. Candidates only achieve BUILD NOW status when all three axes independently confirm high momentum, validated willingness to pay, and weak incumbent competition.'}
            </p>
          </Panel>
        </section>

        {/* The lifecycle, as a numbered instrument strip rather than a bulleted list:
            each step is a stage something passes through, and the ordinal is the point. */}
        <section className="mt-12">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
            <span className="text-accent">01</span> · {t('methodology.lifecycleTitle')}
          </h2>
        <ol className="mt-6 grid gap-px sm:grid-cols-5">
          {steps.map((step, index) => (
            <li key={index} className="border-l border-line py-4 pl-4 pr-4">
              <span className="font-mono text-xl font-bold text-accent">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="mt-3 text-xs leading-relaxed text-fg-muted">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* The gate. Its consequences (WATCH / LOW / hidden from the feed) go in a
          panel because that is the part readers need to be able to quote back. */}
      <section className="mt-14">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
          <span className="text-accent">02</span> · {t('methodology.gateTitle')}
        </h2>
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {gates.map((gate, index) => (
            <li key={index} className="flex gap-5 py-5">
              <span className="w-6 shrink-0 font-mono text-xs font-bold text-fg-subtle">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="text-sm leading-relaxed text-fg-muted">{gate}</p>
            </li>
          ))}
        </ul>
        <Panel tone="raised" brackets className="mt-6 p-5 sm:p-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-warn">
            WHILE THE GATE IS UNMET
          </span>
          <p className="mt-3 text-sm leading-relaxed text-fg-muted">{t('methodology.gateFooter')}</p>
        </Panel>
      </section>

      {/* The band legend, reusing the homepage component so the scale is drawn
          identically wherever it appears. */}
      <section className="mt-14">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
          <span className="text-accent">03</span> · {t('methodology.bandsTitle')}
        </h2>
        <p className="mt-6 text-sm leading-relaxed text-fg-muted">{t('methodology.bandsIntro')}</p>

        <AxisBands
          gates={{ d: t('home.axesGateD'), m: t('home.axesGateM'), w: t('home.axesGateW') }}
          note={t('home.axesNote')}
        />

        <div className="mt-6 space-y-4 text-sm leading-relaxed text-fg-muted">
          <p>{t('methodology.closingNote')}</p>
          <p className="border-l border-warn/60 pl-4">{t('methodology.earlyBetNote')}</p>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
          <span className="text-accent">04</span> · {t('methodology.claimsTitle')}
        </h2>
        <ul className="mt-6 space-y-5">
          {claims.map((claim, index) => (
            <li key={index} className="border-t border-line pt-4 text-sm leading-relaxed text-fg-muted">
              {claim}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-14 flex flex-wrap items-center gap-x-7 gap-y-4 border-t border-line pt-8">
        <Link href="/feed" className={buttonVariants({ size: 'md' })}>
          {t('methodology.backToFeed')}
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href="/track-record"
          className="border-b border-line-strong pb-1 font-mono text-xs text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
        >
          {t('methodology.readProof')}
        </Link>
      </div>
    </PageFrame>
    </>
  );
}
