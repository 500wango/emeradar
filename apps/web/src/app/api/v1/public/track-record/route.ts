import { NextResponse } from 'next/server';
import { TrackRecordService } from '@emeradar/services';
import { internalErrorResponse } from '@/lib/api-errors';

export async function GET() {
  try {
    const data = await TrackRecordService.getPublicTrackRecord();
    return NextResponse.json(data);
  } catch (error) {
    return internalErrorResponse(error, 'public/track-record');
  }
}
