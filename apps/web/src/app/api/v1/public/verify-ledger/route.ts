import { NextRequest, NextResponse } from 'next/server';
import { TrackRecordService } from '@emeradar/services';
import { AppError } from '@emeradar/core';

/**
 * 公开的账本验证端点。
 *
 * 不给日期时验**最新**那一条检查点，而不是一个写死的日期。原来这里默认 `'2026-09-25'`
 * ——那是开发当时手边的一条数据，对任何其它日期（包括账本真实存在的日期）都会答
 * "没有可验证的检查点"，而端点本身仍然返回 400 + `success: false`，看起来像"账本有问题"。
 * 一个公开的验证端点必须能回答"现在这份账本对不对"，否则它验证的是那个常量。
 *
 * 没有任何检查点时返回 404 而不是 400：账本尚未开始与请求有问题是两件事，前者不是
 * 错误（`docs/06`：可复验纪元自第一条检查点起）。
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get('date');
    const date = requested || (await TrackRecordService.latestCheckpointDate());

    if (!date) {
      return NextResponse.json(
        {
          success: false,
          error: 'No ledger checkpoint has been published yet.',
          protocol: 'RFC 6962 / sc-1.0.0',
        },
        { status: 404 }
      );
    }

    const verification = await TrackRecordService.verifyCheckpoint(date);
    return NextResponse.json({
      success: true,
      protocol: 'RFC 6962 / sc-1.0.0',
      ...verification,
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      // `verifyCheckpoint` 对"这一天没有检查点"抛 notFound，于是显式点名一个不存在的
      // 日期也得到 404 —— 与"账本还没开始"是同一个语义，而不是"你的请求有问题"。
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
