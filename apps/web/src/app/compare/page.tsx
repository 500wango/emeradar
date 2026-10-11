import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { AuthService, EntitlementService, OpportunityService } from '@emeradar/services';
import { getServerI18n } from '@/lib/i18n/server';

type CompareSearchParams = { ids?: string | string[] };

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ComparePage({ searchParams }: { searchParams?: Promise<CompareSearchParams> }) {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login?next=%2Fcompare');

  const { isZh } = await getServerI18n();
  const entitlements = await EntitlementService.getUserEntitlements(session.user.id);
  const rawIds = firstParam(searchParams ? (await searchParams).ids : undefined) || '';
  const ids = [...new Set(rawIds.split(',').map((id) => id.trim()).filter(Boolean))];
  let items: Awaited<ReturnType<typeof OpportunityService.compareOpportunities>> = [];
  let error: string | null = null;

  if (ids.length >= 2) {
    try {
      items = await OpportunityService.compareOpportunities(ids, { minAgeDays: entitlements.feedDelayDays });
    } catch (compareError: any) {
      error = compareError.message || (isZh ? '所选机会暂时无法比较。' : 'The selected opportunities cannot be compared.');
    }
  }

  const rows = [
    { key: 'verdict', label: isZh ? '裁决' : 'Verdict', value: (item: typeof items[number]) => item.verdict },
    { key: 'dBand', label: isZh ? '需求 D' : 'Demand D', value: (item: typeof items[number]) => item.dBand },
    { key: 'mBand', label: isZh ? '商业 M' : 'Commercial M', value: (item: typeof items[number]) => item.mBand },
    { key: 'wBand', label: isZh ? '窗口 W' : 'Window W', value: (item: typeof items[number]) => item.wBand },
    { key: 'confidence', label: isZh ? '证据置信度' : 'Evidence confidence', value: (item: typeof items[number]) => item.confidence },
    { key: 'crowding', label: isZh ? '认领拥挤度' : 'Builder crowding', value: (item: typeof items[number]) => `${item.claimsCount}/${item.maxClaims}` },
    { key: 'execution', label: isZh ? '执行规模' : 'Execution class', value: (item: typeof items[number]) => item.executionClass },
    {
      key: 'killCriteria',
      label: isZh ? '止损条件' : 'Kill criteria',
      value: (item: typeof items[number]) => `${item.killCriteriaTriggered}/${item.killCriteriaTotal} ${isZh ? '已触发' : 'triggered'}`,
    },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/feed" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        <ArrowLeft className="h-4 w-4" />
        {isZh ? '返回决策流' : 'Back to decision feed'}
      </Link>
      <div className="mt-6 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-700">{isZh ? '机会比较' : 'Opportunity comparison'}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">{isZh ? '把候选放在同一张决策表上' : 'Compare opportunities on one decision surface'}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          {isZh
            ? `只比较已发布的 BUILD NOW / EARLY BET。当前套餐的数据延迟为 ${entitlements.feedDelayDays} 天，比较不会绕过证据门槛。`
            : `Only published BUILD NOW / EARLY BET records are comparable. Your feed delay is ${entitlements.feedDelayDays} days; comparison does not bypass the evidence gate.`}
        </p>
      </div>

      {ids.length < 2 && (
        <div className="mt-10 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-base font-bold text-slate-900">{isZh ? '先从决策流选择至少两个机会' : 'Select at least two opportunities from the feed'}</h2>
          <p className="mt-2 text-sm text-slate-500">{isZh ? '比较固定展示裁决、D/M/W、置信度、拥挤度、执行规模和止损条件。' : 'The comparison covers verdict, D/M/W, confidence, crowding, execution class, and kill criteria.'}</p>
          <Link href="/feed" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
            {isZh ? '打开决策流' : 'Open decision feed'}
            <ArrowLeft className="h-4 w-4 rotate-180" />
          </Link>
        </div>
      )}

      {error && (
        <div className="mt-10 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900" role="alert">
          {error}
        </div>
      )}

      {items.length >= 2 && !error && (
        <div className="mt-10 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[760px] w-full border-collapse text-left text-sm">
            <caption className="sr-only">{isZh ? '机会并排比较' : 'Side-by-side opportunity comparison'}</caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th scope="col" className="w-44 p-4 text-xs font-semibold uppercase tracking-wide text-slate-500">{isZh ? '维度' : 'Dimension'}</th>
                {items.map((item) => (
                  <th scope="col" key={item.opportunityId} className="min-w-[230px] p-4 align-top">
                    <Link href={`/opportunities/${item.slug}`} className="font-bold text-slate-900 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                      {item.title}
                    </Link>
                    <span className="mt-1 block font-mono text-[11px] font-normal text-slate-500">{item.primaryQuery}</span>
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-normal text-slate-400">
                      {item.marketCountry} · {item.researchLanguage}
                      <ExternalLink className="h-3 w-3" />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="p-4 text-xs font-semibold text-slate-500">{row.label}</th>
                  {items.map((item) => (
                    <td key={`${row.key}-${item.opportunityId}`} className="p-4 font-semibold text-slate-800">{row.value(item)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
