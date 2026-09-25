export interface RFC9457ErrorPayload {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  request_id?: string;
  upgrade?: {
    required_plan: string;
    url: string;
  };
  errors?: Array<{
    path: string;
    message: string;
  }>;
}

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly detail: string;
  public readonly typeUrl: string;
  public readonly upgrade?: { required_plan: string; url: string };
  public readonly validationErrors?: Array<{ path: string; message: string }>;

  constructor(opts: {
    status: number;
    code: string;
    detail: string;
    title?: string;
    typeUrl?: string;
    upgrade?: { required_plan: string; url: string };
    validationErrors?: Array<{ path: string; message: string }>;
  }) {
    super(opts.detail);
    this.name = 'AppError';
    this.status = opts.status;
    this.code = opts.code || 'UNKNOWN_ERROR';
    this.detail = opts.detail;
    this.typeUrl = opts.typeUrl || `https://docs.emeradar.com/errors/${this.code.toLowerCase().replace(/_/g, '-')}`;
    this.upgrade = opts.upgrade;
    this.validationErrors = opts.validationErrors;
  }

  toRFC9457(requestId?: string): RFC9457ErrorPayload {
    return {
      type: this.typeUrl,
      title: this.name,
      status: this.status,
      code: this.code,
      detail: this.detail,
      request_id: requestId,
      upgrade: this.upgrade,
      errors: this.validationErrors,
    };
  }

  static badRequest(detail: string, errors?: Array<{ path: string; message: string }>) {
    return new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      detail,
      validationErrors: errors,
    });
  }

  static unauthenticated(detail = 'Authentication required.') {
    return new AppError({
      status: 401,
      code: 'UNAUTHENTICATED',
      detail,
    });
  }

  static forbidden(detail = 'Permission denied.') {
    return new AppError({
      status: 403,
      code: 'FORBIDDEN',
      detail,
    });
  }

  static planRequired(requiredPlan = 'PRO', detail = 'This feature requires an active Pro subscription.') {
    return new AppError({
      status: 403,
      code: 'PLAN_REQUIRED',
      detail,
      upgrade: {
        required_plan: requiredPlan,
        url: '/pricing',
      },
    });
  }

  static quotaExceeded(detail = 'Monthly quota reached.') {
    return new AppError({
      status: 403,
      code: 'QUOTA_EXCEEDED',
      detail,
      upgrade: {
        required_plan: 'PRO',
        url: '/pricing',
      },
    });
  }

  static notFound(resource = 'Resource') {
    return new AppError({
      status: 404,
      code: 'NOT_FOUND',
      detail: `${resource} not found.`,
    });
  }

  static conflict(detail: string) {
    return new AppError({
      status: 409,
      code: 'CONFLICT',
      detail,
    });
  }

  static preconditionFailed(detail: string) {
    return new AppError({
      status: 422,
      code: 'PRECONDITION_FAILED',
      detail,
    });
  }

  static rateLimited(retryAfterSeconds = 60) {
    return new AppError({
      status: 429,
      code: 'RATE_LIMITED',
      detail: `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
    });
  }

  static internal(detail = 'An unexpected internal error occurred.') {
    return new AppError({
      status: 500,
      code: 'INTERNAL',
      detail,
    });
  }
}

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHENTICATED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  PLAN_REQUIRED: 'PLAN_REQUIRED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class EmeradarError extends AppError {
  constructor(code: string, detail: string, status = 400, meta?: any) {
    super({
      code,
      detail,
      status,
      upgrade: meta?.upgradeUrl ? { required_plan: meta.currentPlan || 'PRO', url: meta.upgradeUrl } : undefined,
    });
  }
}
