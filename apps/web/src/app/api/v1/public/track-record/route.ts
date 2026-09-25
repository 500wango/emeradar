import { NextResponse } from 'next/server';
import { TrackRecordService } from '@emeradar/services';

export async function GET() {
  try {
    const data = await TrackRecordService.getPublicTrackRecord();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Track Record Error', status: 500, detail: error.message },
      { status: 500 }
    );
  }
}
