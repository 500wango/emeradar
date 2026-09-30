import { NextRequest, NextResponse } from 'next/server';
import { ProjectService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser } from '@/lib/auth-server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    return NextResponse.json(await ProjectService.getGscProperties((await params).id, auth.user.id));
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return NextResponse.json({ type: 'about:blank', title: 'Error', status: 500 }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const body = await request.json();
    if (typeof body.propertyUrl !== 'string') return NextResponse.json({ type: 'about:blank', title: 'Validation Error', status: 400 }, { status: 400 });
    await ProjectService.selectGscProperty((await params).id, auth.user.id, body.propertyUrl);
    return NextResponse.json({ propertyUrl: body.propertyUrl, status: 'CONNECTED' });
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return NextResponse.json({ type: 'about:blank', title: 'Error', status: 500 }, { status: 500 });
  }
}
