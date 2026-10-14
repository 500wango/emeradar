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

    // An opportunity project cannot be created here any more. It is a side effect
    // of claiming a slot, and that has to happen in the same transaction as
    // spending the quota — otherwise "create the project now, file the GO later"
    // is a reachable state, and so is "download the launch kit, decide later"
    // (ADR-018, 13 §4.3). The sentence below is the whole point of keeping
    // `opportunityId` in the schema: the caller is told where to go.
    if (body.opportunityId) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Validation Error',
          status: 400,
          detail:
            'Opportunity projects are created by POST /api/v1/opportunities/{id}/go, which claims the build slot and spends the quota in one transaction. This endpoint only creates experiment projects.',
        },
        { status: 400 }
      );
    }
    if (!body.experimentCardId) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation Error', status: 400, detail: 'experimentCardId is required' },
        { status: 400 }
      );
    }

    const project = await ProjectService.createExperimentProject(userId, {
      experimentCardId: body.experimentCardId,
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
    return internalErrorResponse(error, 'projects');
  }
}
