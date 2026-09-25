import { NextRequest, NextResponse } from 'next/server';
import { TrackRecordService } from '@emeradar/services';

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
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 400 }
    );
  }
}
