import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService, EntitlementService, InboxService } from '@emeradar/services';
import { InboxClient } from '@/components/InboxClient';

/**
 * Opportunity Inbox — 早期信号层。
 *
 * 与 Feed 的区别：这里展示 `status='CANDIDATE'` 的机会，明确标 EARLY_SIGNAL；
 * 不冒充 BUILD_NOW / EARLY_BET。Free 只取 3 条，付费取 20 条。
 */
export default async function InboxPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login?next=/inbox');

  const ent = await EntitlementService.getUserEntitlements(session.user.id);
  const data = await InboxService.list(session.user.id, ent.opportunityDetailFull);
  return <InboxClient initialData={data} />;
}
