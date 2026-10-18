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
  /**
   * 按 `code` 定义的补充信息。放进错误体而不是塞进 `detail` 字符串里，是因为
   * 调用方要**用它做判断**而不只是显示：`ALREADY_GO` 的 `project_id` 决定前端是
   * 跳转既有项目还是重试，而从一句话里正则抠出 id 是在逼调用方解析人类可读文本。
   */
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly detail: string;
  public readonly typeUrl: string;
  public readonly upgrade?: { required_plan: string; url: string };
  public readonly validationErrors?: Array<{ path: string; message: string }>;
  public readonly details?: Record<string, unknown>;

  constructor(opts: {
    status: number;
    code: string;
    detail: string;
    title?: string;
    typeUrl?: string;
    upgrade?: { required_plan: string; url: string };
    validationErrors?: Array<{ path: string; message: string }>;
    details?: Record<string, unknown>;
  }) {
    super(opts.detail);
    this.name = 'AppError';
    this.status = opts.status;
    this.code = opts.code || 'UNKNOWN_ERROR';
    this.detail = opts.detail;
    this.typeUrl = opts.typeUrl || `https://docs.emeradar.com/errors/${this.code.toLowerCase().replace(/_/g, '-')}`;
    this.upgrade = opts.upgrade;
    this.validationErrors = opts.validationErrors;
    this.details = opts.details;
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
      details: this.details,
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
  /**
   * 同一 (用户, 机会, 裁决) 已经 GO 过。v3.1 的重复 GO 是幂等的：响应带既有
   * `details.project_id`，配额不再重复扣减（01 §1.8 第 5 条、ADR-018）。
   */
  ALREADY_GO: 'ALREADY_GO',
  /** 质押凭证的 HTTP 探针校验未通过（页面不可达 / 与机会主词相关性不足）。 */
  CREDENTIAL_UNVERIFIED: 'CREDENTIAL_UNVERIFIED',
  /** Phase 1 席位已满（Pro 30 / Founding 50，PRD v2.2 Q6、Q12）；结账页应显示候补。 */
  SEATS_FULL: 'SEATS_FULL',
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
      details: meta?.details,
    });
  }
}
