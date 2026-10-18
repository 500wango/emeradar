import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService, EntitlementService } from '@emeradar/services';
import { LiveScanner } from '@/components/LiveScanner';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { getServerI18n } from '@/lib/i18n/server';

/**
 * 自定义词即时初筛（PRD F3 第 1 阶段）。
 *
 * 结果是 CANDIDATE，不是构建裁决；Pro 可以顺手把它加入 7 天雷达。详情页只对
 * TRACKED 开放，所以这里不渲染"进入详情"，只给雷达/升级两条下一步。
 */
export default async function ScanPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login?next=%2Fscan');

  const ent = await EntitlementService.getUserEntitlements(session.user.id);
  const { t } = await getServerI18n();

  return (
    <PageFrame width="prose">
      <PageHeader eyebrow={t('scan.badge')} title={t('scan.title')} lede={t('scan.desc')} />
      <Panel className="mt-8 p-6">
        <LiveScanner canTrackRadar={ent.pulseRadar} showQuickChips />
      </Panel>
      <p className="mt-4 text-xs leading-relaxed text-fg-subtle">{t('scan.quotaNote')}</p>
    </PageFrame>
  );
}
