import { NextRequest, NextResponse } from 'next/server';
import { ProjectService } from '@emeradar/services';
import { AppError, parseInput, projectCreateSchema } from '@emeradar/core';
import { internalErrorResponse } from '@/lib/api-errors';
import { getAuthUser, requireScope, requireVerifiedEmail } from '@/lib/auth-server';

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
    return internalErrorResponse(error, 'projects');
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ type: 'about:blank', title: 'Unauthorized', status: 401 }, { status: 401 });
    const scopeError = requireScope(auth, 'projects:write');
    if (scopeError) return scopeError;
    const verificationError = requireVerifiedEmail(auth);
    if (verificationError) return verificationError;
    const userId = auth.user.id;
    const body = parseInput(projectCreateSchema, await request.json().catch(() => ({})));

    let project: unknown;
    if (body.experimentCardId) {
      project = await ProjectService.createExperimentProject(userId, {
        experimentCardId: body.experimentCardId,
        title: body.title,
        domain: body.domain,
        buildType: body.buildType,
        targetKeywords: body.targetKeywords,
      });
    } else if (body.opportunityId) {
      project = await ProjectService.createProject(userId, {
        opportunityId: body.opportunityId,
        decisionId: body.decisionId,
        reportId: body.reportId,
        title: body.title,
        domain: body.domain,
        buildType: body.buildType,
        targetKeywords: body.targetKeywords,
      });
    } else {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation Error', status: 400, detail: 'opportunityId or experimentCardId is required' },
        { status: 400 }
      );
    }

    return NextResponse.json(project, { status: 201 });
  } catch (error: any) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toRFC9457(), { status: error.status });
    }
    return internalErrorResponse(error, 'projects');
  }
}
