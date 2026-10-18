import { NextRequest, NextResponse } from 'next/server';
import { EntitlementService, InboxService } from '@emeradar/services';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

/** Opportunity Inbox：早期信号，不是已发布裁决。 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401 },
        { status: 401 }
      );
    }
    const scopeError = requireScope(auth, 'opportunities:read');
    if (scopeError) return scopeError;

    const ent = await EntitlementService.getUserEntitlements(auth.user.id);
    const data = await InboxService.list(auth.user.id, ent.opportunityDetailFull);
    return NextResponse.json(data);
  } catch (error) {
    return internalErrorResponse(error, 'opportunities/inbox');
  }
}
