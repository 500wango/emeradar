import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getServerI18n } from '@/lib/i18n/server';
import { getHomeTelemetry } from '@/lib/observatory/telemetry';
import { buttonVariants } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { Stat } from '@/components/ui/Stat';
import { AxisBands } from '@/components/observatory/AxisBands';
import { ReportSkeleton } from '@/components/observatory/ReportSkeleton';
import { SignalCard } from '@/components/observatory/SignalCard';
import { TelemetryPanel } from '@/components/observatory/TelemetryPanel';
import { Ticker } from '@/components/observatory/Ticker';

/** docs/16 §3.1a caps the homepage at two published BUILD NOW cards. */
const MAX_BUILD_NOW = 2;
const MAX_EARLY_BET = 4;

/**
 * Keeps the last word of the headline whole. `Micro-SaaS` carries a break
 * opportunity at its hyphen, so at large sizes the browser happily split it into
 * `Micro-` / `SaaS`; a nowrap span moves the word to the next line instead.
 */
function UnbreakableTail({ text }: { text: string }) {
  const trimmed = text.trimEnd();
  const cut = trimmed.lastIndexOf(' ');
  if (cut < 0) return <>{text}</>;
  return (
    <>
      {trimmed.slice(0, cut + 1)}
      <span className="whitespace-nowrap">{trimmed.slice(cut + 1)}</span>
    </>
  );
}

export default async function HomePage() {
  const { t } = await getServerI18n();
  const telemetry = await getHomeTelemetry();

  const buildNow = telemetry.cards.filter((card) => card.verdict === 'BUILD_NOW').slice(0, MAX_BUILD_NOW);
  const earlyBet = telemetry.cards.filter((card) => card.verdict === 'EARLY_BET').slice(0, MAX_EARLY_BET);
  const boardCards = [...buildNow, ...earlyBet];

  const cardLabels = { report: t('home.cardReport'), workspace: t('home.cardWorkspace') };

  const pillars = [
    {
      id: 'd',
      index: '01',
      axis: 'D',
      axisClass: 'text-axis-d',
      title: t('home.pillarDemandTitle'),
      desc: t('home.pillarDemandDesc'),
      note: t('home.pillarDemandNote'),
    },
    {
      id: 'm',
      index: '02',
      axis: 'M',
      axisClass: 'text-axis-m',
      title: t('home.pillarCommercialTitle'),
      desc: t('home.pillarCommercialDesc'),
      note: t('home.pillarCommercialNote'),
    },
    {
      id: 'w',
      index: '03',
      axis: 'W',
      axisClass: 'text-axis-w',
      title: t('home.pillarWindowTitle'),
      desc: t('home.pillarWindowDesc'),
      note: t('home.pillarWindowNote'),
    },
  ];

  const steps = [
    { num: '01', title: t('home.step1Title'), desc: t('home.step1Desc') },
    { num: '02', title: t('home.step2Title'), desc: t('home.step2Desc') },
    { num: '03', title: t('home.step3Title'), desc: t('home.step3Desc') },
    { num: '04', title: t('home.step4Title'), desc: t('home.step4Desc') },
  ];

  const reportPoints = [
    { index: '01', title: t('home.reportPoint1Title'), desc: t('home.reportPoint1Desc') },
    { index: '02', title: t('home.reportPoint2Title'), desc: t('home.reportPoint2Desc') },
    { index: '03', title: t('home.reportPoint3Title'), desc: t('home.reportPoint3Desc') },
    { index: '04', title: t('home.reportPoint4Title'), desc: t('home.reportPoint4Desc') },
  ];

  const comparisonRows = [
    { trad: t('home.comparisonRow1Trad'), eme: t('home.comparisonRow1Eme') },
    { trad: t('home.comparisonRow2Trad'), eme: t('home.comparisonRow2Eme') },
    { trad: t('home.comparisonRow3Trad'), eme: t('home.comparisonRow3Eme') },
    { trad: t('home.comparisonRow4Trad'), eme: t('home.comparisonRow4Eme') },
  ];

  const principles = [
    { title: t('home.principle1Title'), desc: t('home.principle1Desc') },
    { title: t('home.principle2Title'), desc: t('home.principle2Desc') },
    { title: t('home.principle3Title'), desc: t('home.principle3Desc') },
  ];

  // The strip echoes the same records the board shows — query plus the three
  // band readings, all read from the opportunity table.
  const tickerItems = telemetry.cards.slice(0, 8).map((card) => (
    <>
      <span className="text-fg-muted">{`\`${card.primaryQuery}\``}</span>
      {` D ${card.dBand} · M ${card.mBand} · W ${card.wBand}`}
    </>
  ));

  return (
    <div>
      {/* 1 ── Hero: claim on the left, live ledger readings on the right */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute left-1/2 top-[-20rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-signal/5 blur-3xl"
          aria-hidden="true"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-16 pt-20 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-8 lg:pb-24 lg:pt-24">
          <div>
            <span className="inline-flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.22em] text-signal">
              <span className="h-px w-8 shrink-0 bg-signal/60" aria-hidden="true" />
              <span className="obs-blink h-1.5 w-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
              {/* `US-EN` is a single token; left to wrap, the browser breaks it
                  at the hyphen and strands `EN` on its own line. */}
              <span>
                Search Signal Intelligence
                <span className="whitespace-nowrap"> · US-EN</span>
              </span>
            </span>

            {/* `whitespace-pre-line` honours the \n in the headline, so the
                break lands where the design wants it instead of wherever the
                viewport happens to run out of room. The English headline is
                longer than the Chinese one, so the smallest size has to keep a
                whole clause on a line — at 4xl it ran to six lines on a phone. */}
            <h1 className="mt-7 whitespace-pre-line font-display text-3xl font-extrabold leading-[1.12] tracking-tight text-fg sm:text-4xl sm:leading-[1.12] lg:text-[2.75rem] xl:text-[3.5rem]">
              <UnbreakableTail text={t('home.heroTitle')} />
            </h1>

            <p className="mt-6 max-w-lg text-sm leading-relaxed text-fg-muted sm:text-base sm:leading-relaxed">
              {t('home.heroDesc')}
            </p>

            {/* 375 下三件套挤成「pill + 一个链接」/「另一个链接」两行，右侧留下
                半行空白。窄屏改为竖排左对齐，两个文字链接并成一行挂在 pill 下面。 */}
            <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7">
              <Link href="/feed" className={buttonVariants({ size: 'lg' })}>
                {t('home.ctaDecisions')}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <div className="flex items-center gap-6 sm:contents">
                <Link
                  href="/methodology"
                  className="border-b border-line-strong pb-1 font-mono text-xs text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
                >
                  {t('home.ctaMethodology')}
                </Link>
                <Link
                  href="/pricing"
                  className="border-b border-line-strong pb-1 font-mono text-xs text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
                >
                  {t('home.ctaPricing')}
                </Link>
              </div>
            </div>

            <p className="mt-9 text-xs leading-relaxed text-fg-subtle">{t('home.badge')}</p>
          </div>

          <TelemetryPanel telemetry={telemetry} cards={boardCards} note={t('home.heroPanelNote')} />
        </div>
      </section>

      {/* 2 ── Live strip (only when there is something to scroll) */}
      {telemetry.cards.length >= 3 && <Ticker items={tickerItems} />}

      {/* 3 ── Method constants, as a hairline instrument strip */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 py-12 sm:px-6 lg:grid-cols-4 lg:px-8">
          <Stat value={t('home.stat1Number')} label={t('home.stat1Label')} tone="accent" />
          <Stat value={t('home.stat2Number')} label={t('home.stat2Label')} />
          <Stat value={t('home.stat3Number')} label={t('home.stat3Label')} />
          <Stat value={t('home.stat4Number')} label={t('home.stat4Label')} />
        </div>
      </section>

      {/* 4 ── Signal board: published decisions, BUILD NOW first */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading
              eyebrow={t('home.signalBoardBadge')}
              title={t('home.signalBoardTitle')}
              lede={t('home.signalBoardDesc')}
            />
            <div className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle sm:text-right">
              <div>{t('home.signalBoardLimit')}</div>
              <div className="mt-1.5 text-signal">
                {buildNow.length} BUILD NOW · {earlyBet.length} EARLY BET
              </div>
            </div>
          </div>

          {boardCards.length > 0 ? (
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {boardCards.map((card) => (
                <SignalCard key={card.opportunityId} card={card} labels={cardLabels} />
              ))}
            </div>
          ) : (
            /* docs/15 §3: when nothing cleared the gate we say exactly that
               instead of rendering a fabricated showcase record. */
            <Panel brackets className="mt-12 p-8 sm:p-12">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-warn">
                No publication this cycle
              </span>
              <h3 className="mt-4 font-display text-xl font-bold text-fg sm:text-2xl">
                {t('home.emptyTitle')}
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-muted">{t('home.emptyDesc')}</p>
              <Link
                href="/methodology"
                className={buttonVariants({ variant: 'outline', size: 'md', className: 'mt-7' })}
              >
                {t('home.emptyCta')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Panel>
          )}

          <div className="mt-12 flex flex-col gap-8 border-t border-line pt-8 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link href="/feed" className={buttonVariants({ size: 'md' })}>
                {t('home.openFeed')}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="mt-5 max-w-xl text-xs leading-relaxed text-fg-subtle">
                {t('home.observationRequestNote')}
              </p>
            </div>
            <div className="max-w-sm sm:text-right">
              <p className="text-xs leading-relaxed text-fg-subtle">{t('home.gatedMessage')}</p>
              <Link
                href="/login?next=%2Ffeed"
                className="mt-3 inline-block font-mono text-xs font-bold text-accent transition-colors hover:brightness-110"
              >
                {t('home.signInToView')} →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 5 ── The three axes and the gate each one has to clear */}
      <section className="border-b border-line bg-surface/20">
        <div className="mx-auto grid max-w-6xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:px-8">
          <div>
            <SectionHeading
              eyebrow={t('home.axesBadge')}
              title={t('home.axesTitle')}
              lede={t('home.axesDesc')}
            />

            <div className="mt-10 divide-y divide-line border-y border-line">
              {pillars.map((pillar) => (
                <div key={pillar.id} className="flex flex-col gap-3 py-6 sm:flex-row sm:gap-8">
                  <div className="w-24 shrink-0">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
                      AXIS / <span className={pillar.axisClass}>{pillar.axis}</span>
                    </div>
                    {/* `fg-subtle` rather than an alpha of `fg`: an alpha
                        modifier on a text token is not a de-emphasis knob, it is
                        a contrast cut, and 50% lands at 3.3:1. The numeral is a
                        real label, so it must not be `aria-hidden` either. */}
                    <div className="mt-1 font-mono text-sm font-bold tracking-[0.14em] text-fg-subtle">
                      {pillar.index}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-fg">{pillar.title}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-fg-muted">{pillar.desc}</p>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
                      SOURCE → {pillar.note}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <AxisBands
            gates={{ d: t('home.axesGateD'), m: t('home.axesGateM'), w: t('home.axesGateW') }}
            note={t('home.axesNote')}
          />
        </div>
      </section>

      {/* 6 ── What a published report contains */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
          <div>
            <SectionHeading
              eyebrow={t('home.reportSectionBadge')}
              title={t('home.reportSectionTitle')}
              lede={t('home.reportSectionDesc')}
            />
            <div className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
              {reportPoints.map((point) => (
                <div key={point.index} className="border-t border-line pt-4">
                  <div className="font-mono text-[10px] tracking-[0.18em] text-fg-subtle">
                    SEC {point.index}
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-fg">{point.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{point.desc}</p>
                </div>
              ))}
            </div>
            <Link
              href="/feed"
              className="mt-9 inline-flex items-center gap-2 border-b border-line-strong pb-1 font-mono text-xs text-accent transition-colors hover:brightness-110"
            >
              {t('home.reportCta')}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <ReportSkeleton caption={t('home.reportPreviewCaption')} />
        </div>
      </section>

      {/* 7 ── Two-column hairline comparison */}
      <section className="border-b border-line bg-surface/20">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeading
            align="center"
            eyebrow={t('home.comparisonBadge')}
            title={t('home.comparisonTitle')}
            lede={t('home.comparisonSubtitle')}
          />

          <div className="mt-12 border-t border-line">
            <div className="hidden grid-cols-1 border-b border-line md:grid md:grid-cols-2">
              <div className="px-5 py-4 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-subtle">
                {t('home.comparisonColTrad')}
              </div>
              <div className="px-5 py-4 font-mono text-[10px] uppercase tracking-[0.16em] text-accent md:border-l md:border-line">
                {t('home.comparisonColEme')}
              </div>
            </div>

            <div className="divide-y divide-line">
              {comparisonRows.map((row, index) => (
                /* Stacked on narrow screens, so each cell carries its own column
                   label — without it the two sides read as one alternating list. */
                <div key={index} className="grid grid-cols-1 md:grid-cols-2">
                  <div className="border-b border-line px-5 py-5 md:border-b-0 md:border-r md:border-line">
                    <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.18em] text-fg-subtle md:hidden">
                      {t('home.comparisonColTrad')}
                    </span>
                    <p className="text-xs leading-relaxed text-fg-subtle">{row.trad}</p>
                  </div>
                  <div className="px-5 py-5">
                    <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.18em] text-accent md:hidden">
                      {t('home.comparisonColEme')}
                    </span>
                    <p className="text-xs leading-relaxed text-fg">{row.eme}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 8 ── The loop, then plans and principles as one closing block */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow={t('home.decisionLoopBadge')}
            title={t('home.decisionLoopTitle')}
            lede={t('home.decisionLoopSubtitle')}
          />

          <ol className="mt-12 grid gap-y-8 gap-x-8 border-t border-line pt-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <li key={step.num} className="border-l border-line pl-5">
                <span className="font-mono text-2xl font-bold text-accent">{step.num}</span>
                <h3 className="mt-4 font-display text-base font-bold text-fg">{step.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-fg-muted">{step.desc}</p>
              </li>
            ))}
          </ol>

          <Panel className="mt-16 p-8 sm:p-12">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
              {t('home.pricingBannerBadge')}
            </span>
            <h2 className="mt-4 max-w-2xl font-display text-2xl font-bold leading-tight text-fg sm:text-4xl sm:leading-tight">
              {t('home.pricingBannerTitle')}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-muted">
              {t('home.pricingBannerDesc')}
            </p>

            <div className="mt-8 grid gap-px sm:grid-cols-2">
              <div className="border-l border-accent/60 bg-surface-2/40 py-4 pl-4 pr-5 text-xs leading-relaxed text-fg-muted">
                {t('home.freeDelayHighlight')}
              </div>
              <div className="border-l border-signal/60 bg-surface-2/40 py-4 pl-4 pr-5 text-xs leading-relaxed text-fg-muted">
                {t('home.proRealtimeHighlight')}
              </div>
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
              <Link href="/pricing" className={buttonVariants({ size: 'lg' })}>
                {t('home.explorePricingBtn')}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/register"
                className="border-b border-line-strong pb-1 font-mono text-xs text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
              >
                {t('home.ctaSignUp')}
              </Link>
            </div>
          </Panel>

          <div className="mt-20 border-t border-line pt-14">
            <SectionHeading align="center" title={t('home.principlesTitle')} lede={t('home.principlesSubtitle')} />
            <div className="mt-10 grid gap-8 md:grid-cols-3">
              {principles.map((principle, index) => (
                <div key={principle.title} className="border-t border-line pt-5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
                    Principle {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="mt-3 text-sm font-semibold text-fg">{principle.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-fg-muted">{principle.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
