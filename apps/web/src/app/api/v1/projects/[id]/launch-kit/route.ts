import { NextRequest, NextResponse } from 'next/server';
import { LaunchKitService } from '@emeradar/services';
import { AppError, type Locale } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope } from '@/lib/auth-server';

/**
 * 形态点火包导出（10 §4.4、09 §5.3）。
 *
 * 这个端点是 ADR-018 唯一允许的出口：**没有 GO 就没有点火包**。而这句话不能只是
 * 前端约定——准入判据落在 `slot_claims` 上（见 `LaunchKitService.claimFor`），
 * 所以任何绕过界面的调用同样拿不到东西。
 *
 * 重复导出**不重复扣额**，而且这里连一次"检查额度"都不做：额度在 GO 那一刻已经
 * 结清（13 §4.3 明写 Pro 的报告与点火包不设第二份额度）。一个在导出时再查一次额度
 * 的实现，会在用户额度刚好用尽的那天把他已经买到手的产物锁在门外。
 *
 * 每次响应都带三个版本头（10 §4.4）：snapshot / template / scoring_config。用户
 * 拿它们自查"同一份输入是否产出同一份交付物"（09 §5.3 硬约束 1）——这也是为什么
 * 产物一旦装配就冻结进库，而不是每次重新渲染。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    }
    const scopeError = requireScope(auth, 'projects:read');
    if (scopeError) return scopeError;

    const { id } = await params;
    const format = new URL(request.url).searchParams.get('format') ?? 'bundle';
    if (!['bundle', 'md', 'json'].includes(format)) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Bad Request', status: 400, detail: 'format must be one of bundle, md, json.' },
        { status: 400 }
      );
    }

    const localeParam = new URL(request.url).searchParams.get('locale');
    const locale: Locale | undefined =
      localeParam === 'zh-CN' || localeParam === 'en-US' ? localeParam : undefined;

    const view = await LaunchKitService.getOrCreate(id, auth.user.id, { locale });

    const headers: Record<string, string> = {
      'X-Launch-Kit-Snapshot': view.snapshotId,
      'X-Launch-Kit-Template-Version': view.templateVersion,
      'X-Scoring-Config-Version': view.scoringConfigVersion,
      // 冻结的产物可以安全地长期缓存：同一 project 的同一形态永远不会再变。
      'Cache-Control': 'private, max-age=0, must-revalidate',
      // `Content-Disposition` 的文件名只用 ASCII：项目标题可能含中文或引号，直接拼进
      // 头里会破坏语法或让浏览器把文件名截断。RFC 5987 的 `filename*` 留给真正需要
      // 中文名的场景，这里用形态与项目 id 就足够区分。
      'X-Launch-Kit-Id': view.launchKitId,
    };

    if (format === 'bundle') {
      const zip = LaunchKitService.zip(view);
      return new NextResponse(new Uint8Array(zip), {
        status: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="launch-kit-${view.archetype.toLowerCase()}-${id}.zip"`,
        },
      });
    }

    if (format === 'md') {
      // `md` 把三件套拼成一份带文件分隔的 Markdown：给不想解压、只想整体看一眼或
      // 直接粘进对话的用户。分隔标题用的是文件自己的路径，与 zip 内路径一致，
      // 所以两种格式说的是同一份东西。
      const body = view.files
        .map((file) => `<!-- ===== ${file.path} ===== -->\n\n${file.content}`)
        .join('\n\n---\n\n');
      return new NextResponse(body, {
        status: 200,
        headers: {
          ...headers,
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="launch-kit-${view.archetype.toLowerCase()}-${id}.md"`,
        },
      });
    }

    return NextResponse.json(
      {
        launchKitId: view.launchKitId,
        projectId: view.projectId,
        reportId: view.reportId,
        archetype: view.archetype,
        schemaVersion: view.schemaVersion,
        templateVersion: view.templateVersion,
        snapshotId: view.snapshotId,
        scoringConfigVersion: view.scoringConfigVersion,
        researchLanguage: view.researchLanguage,
        obsDate: view.obsDate,
        contentHash: view.contentHash,
        generatedAt: view.generatedAt,
        files: view.files,
      },
      { status: 200, headers }
    );
  } catch (error: any) {
    if (error instanceof AppError) return NextResponse.json(error.toRFC9457(), { status: error.status });
    return internalErrorResponse(error, 'projects/id/launch-kit');
  }
}
