import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { AuthService, OpportunityService } from '@emeradar/services';
import { getServerI18n } from '@/lib/i18n/server';
import { AxisBadge, Badge, VerdictBadge, type Verdict } from '@/components/ui/Badge';
import { buttonVariants } from '@/components/ui/Button';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';

type CompareSearchParams = { ids?: string | string[] };

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ComparePage({ searchParams }: { searchParams?: Promise<CompareSearchParams> }) {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login?next=%2Fcompare');

  const { t } = await getServerI18n();
  const rawIds = firstParam(searchParams ? (await searchParams).ids : undefined) || '';
  const ids = [...new Set(rawIds.split(',').map((id) => id.trim()).filter(Boolean))];
  let items: Awaited<ReturnType<typeof OpportunityService.compareOpportunities>> = [];
  let error: string | null = null;

  if (ids.length >= 2) {
    try {
      items = await OpportunityService.compareOpportunities(ids);
    } catch (compareError: any) {
      error = compareError.message || t('compare.errorDefault');
    }
  }

  type CompareItem = (typeof items)[number];

  const rows: Array<{ key: string; label: string; render: (item: CompareItem) => ReactNode }> = [
    { key: 'verdict', label: t('compare.rowVerdict'), render: (item) => <VerdictBadge verdict={item.verdict as Verdict} /> },
    { key: 'dBand', label: t('compare.rowDemand'), render: (item) => <AxisBadge axis="d" band={item.dBand} /> },
    { key: 'mBand', label: t('compare.rowCommercial'), render: (item) => <AxisBadge axis="m" band={item.mBand} /> },
    { key: 'wBand', label: t('compare.rowWindow'), render: (item) => <AxisBadge axis="w" band={item.wBand} /> },
    { key: 'confidence', label: t('compare.rowConfidence'), render: (item) => <Badge tone="neutral">{item.confidence}</Badge> },
    { key: 'execution', label: t('compare.rowExecution'), render: (item) => <Badge tone="neutral">{item.executionClass}</Badge> },
    {
      key: 'killCriteria',
      label: t('compare.rowKill'),
      render: (item) => (
        <span className="font-mono text-xs text-fg-muted">
          {t('compare.killTriggered', { triggered: item.killCriteriaTriggered, total: item.killCriteriaTotal })}
        </span>
      ),
    },
  ];

  return (
    <PageFrame width="full">
      <Link href="/feed" className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <ArrowLeft className="h-4 w-4" />
        {t('compare.backToFeed')}
      </Link>

      <PageHeader
        className="mt-6"
        eyebrow={t('compare.eyebrow')}
        title={t('compare.title')}
        lede={t('compare.desc')}
      />

      {ids.length < 2 && (
        <Panel className="mt-10 p-8 text-center">
          <h2 className="text-base font-bold text-fg">{t('compare.selectTwoTitle')}</h2>
          <p className="mt-2 text-sm text-fg-muted">{t('compare.selectTwoDesc')}</p>
          <Link href="/feed" className={buttonVariants({ size: 'md', className: 'mt-6' })}>
            {t('compare.openFeed')}
            <ArrowLeft className="h-4 w-4 rotate-180" />
          </Link>
        </Panel>
      )}

      {error && (
        <div className="mt-10 rounded-sm border border-warn/40 bg-warn/10 p-6 text-sm text-warn" role="alert">
          {error}
        </div>
      )}

      {items.length >= 2 && !error && (
        <Panel className="mt-10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <caption className="sr-only">{t('compare.tableCaption')}</caption>
              <thead className="border-b border-line bg-surface-2">
                <tr>
                  <th scope="col" className="w-44 p-4 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle">{t('compare.colDimension')}</th>
                  {items.map((item) => (
                    <th scope="col" key={item.opportunityId} className="min-w-[230px] p-4 align-top">
                      <Link href={`/opportunities/${item.slug}`} className="font-bold text-fg transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                        {item.title}
                      </Link>
                      <span className="mt-1 block font-mono text-[11px] font-normal text-fg-subtle">{item.primaryQuery}</span>
                      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-normal text-fg-subtle">
                        {item.marketCountry} · {item.researchLanguage}
                        <ExternalLink className="h-3 w-3" />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className="p-4 text-xs font-semibold text-fg-muted">{row.label}</th>
                    {items.map((item) => (
                      <td key={`${row.key}-${item.opportunityId}`} className="p-4 font-semibold text-fg">{row.render(item)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </PageFrame>
  );
}
