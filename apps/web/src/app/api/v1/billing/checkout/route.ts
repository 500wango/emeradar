import { NextRequest, NextResponse } from 'next/server';
import { StripeService } from '@emeradar/services';
import { AppError, checkoutSchema, parseInput, z } from '@emeradar/core';
import { getAuthUser, requireVerifiedEmail } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Authentication required to initiate checkout.' },
        { status: 401 }
      );
    }
    if (auth.authMethod === 'api_key') {
      return NextResponse.json({ type: 'about:blank', title: 'Session Required', status: 403, detail: 'Checkout requires an interactive user session.' }, { status: 403 });
    }
    const verificationError = requireVerifiedEmail(auth);
    if (verificationError) return verificationError;

    // TEAM intent must still reach the design-partner check below, so the body is
    // validated for shape here and the plan gate stays explicit.
    const parsed = parseInput(
      checkoutSchema.extend({ planCode: z.union([z.literal('STARTER'), z.literal('PRO'), z.literal('TEAM'), z.string().max(40)]) }),
      await request.json().catch(() => ({}))
    );
    const { planCode, billingCycle, returnUrl } = parsed;

    if (planCode !== 'STARTER' && planCode !== 'PRO' && planCode !== 'TEAM') {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Invalid Plan',
          status: 400,
          detail: 'Valid subscription plans are STARTER, PRO or TEAM.',
        },
        { status: 400 }
      );
    }

    if (planCode === 'TEAM') {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Design Partner Only',
          status: 403,
          code: 'DESIGN_PARTNER_ONLY',
          detail: 'Team subscriptions are currently available only through a design partner agreement.',
        },
        { status: 403 }
      );
    }

    if (billingCycle !== 'monthly' && billingCycle !== 'yearly' && billingCycle !== 'lifetime') {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Invalid Billing Cycle',
          status: 400,
          detail: 'Billing cycle must be monthly, yearly, or lifetime.',
        },
        { status: 400 }
      );
    }

    const session = await StripeService.createCheckoutSession({
      userId: auth.user.id,
      planCode,
      billingCycle,
      returnUrl,
    });

    return NextResponse.json(session);
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    console.error('[api] Unhandled error:', error);
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Checkout Error',
        status: error.status || 500,
        detail: 'An error occurred while creating checkout session.',
      },
      { status: error.status || 500 }
    );
  }
}
