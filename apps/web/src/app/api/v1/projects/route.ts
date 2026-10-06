import { NextRequest, NextResponse } from 'next/server';
import { ProjectService } from '@emeradar/services';
import { AppError } from '@emeradar/core';
import { getAuthUser, requireScope } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:read');
    if (scopeError) return scopeError;
    const userId = auth.user.id;
    const projects = await ProjectService.listUserProjects(userId);
    return NextResponse.json(projects);
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Error', status: 500, detail: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;
    const userId = auth.user.id;
    const body = await request.json();

    if ((!body.opportunityId && !body.experimentCardId) || !body.title) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation Error', status: 400, detail: 'opportunityId or experimentCardId, and title are required' },
        { status: 400 }
      );
    }

    const project = body.experimentCardId
      ? await ProjectService.createExperimentProject(userId, {
          experimentCardId: body.experimentCardId,
          title: body.title,
          domain: body.domain,
          buildType: body.buildType,
          targetKeywords: body.targetKeywords,
        })
      : await ProjectService.createProject(userId, {
      opportunityId: body.opportunityId,
      decisionId: body.decisionId,
      reportId: body.reportId,
      title: body.title,
      domain: body.domain,
      buildType: body.buildType,
      targetKeywords: body.targetKeywords,
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Project Creation Error', status: 500, detail: error.message },
      { status: 500 }
    );
  }
}
