import { NextRequest, NextResponse } from 'next/server';
import { StripeService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Authentication required to initiate checkout.' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { planCode, billingCycle = 'yearly', returnUrl } = body;

    if (planCode !== 'PRO' && planCode !== 'TEAM') {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Invalid Plan',
          status: 400,
          detail: 'Valid subscription plans are PRO or TEAM.',
        },
        { status: 400 }
      );
    }

    if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Invalid Billing Cycle',
          status: 400,
          detail: 'Billing cycle must be either monthly or yearly.',
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
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Checkout Error',
        status: error.status || 500,
        detail: error.message || 'An error occurred while creating checkout session.',
      },
      { status: error.status || 500 }
    );
  }
}
