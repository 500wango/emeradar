import { NextRequest, NextResponse } from 'next/server';
import { TrackRecordService } from '@emeradar/services';
import { AppError } from '@emeradar/core';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || '2026-09-25';

    const verification = await TrackRecordService.verifyCheckpoint(date);
    return NextResponse.json({
      success: true,
      protocol: 'RFC 6962 / sc-1.0.0',
      ...verification,
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    // Never echo a raw driver/runtime message from a public endpoint.
    console.error('[public/verify-ledger] Error:', error);
    return NextResponse.json(
      { success: false, error: 'No checkpoint could be verified for the requested date.' },
      { status: 400 }
    );
  }
}
