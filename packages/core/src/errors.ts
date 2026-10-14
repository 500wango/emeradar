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
   * 调用方要**用它做判断**而不只是显示：`SLOT_TAKEN` 的 `alternatives[]` 决定前端
   * 是提示"换个形态"还是"换条机会"，而从一句话里正则抠出候选形态是在逼调用方
   * 解析人类可读文本。
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
   * 槽位被别人占了（`claimed == capacity`）。与 `QUOTA_EXCEEDED` 必须严格区分：
   * 前者换一个形态或换一条机会就有救，后者是用户自己这个月的额度用完了。
   * 前端据此给完全不同的引导（10 §1.1、16 §3.3）。
   */
  SLOT_TAKEN: 'SLOT_TAKEN',
  /** 该用户同时活跃的 GO 已达 `active_go_slots_max`（默认 2）。与"别人的槽位满了"无关。 */
  ACTIVE_SLOTS_EXCEEDED: 'ACTIVE_SLOTS_EXCEEDED',
  /** 存在质押逾期未处理的项目，须先处理才能发起新的 GO。 */
  STAKE_REQUIRED: 'STAKE_REQUIRED',
  /** 质押凭证的 HTTP 探针校验未通过（页面不可达 / 与机会主词相关性不足）。 */
  CREDENTIAL_UNVERIFIED: 'CREDENTIAL_UNVERIFIED',
  /**
   * 买断下单时该机会已被认领（`Σclaimed > 0`），处女地条件不再满足（10 §1.1）。
   * 只在**调用者本来就能看到该机会**时使用——对保护期内的非持有者要返回 404 与
   * "不存在"同形，否则这个错误码本身就成了存在性探测器（10 §7）。
   */
  STEALTH_LOCK_UNAVAILABLE: 'STEALTH_LOCK_UNAVAILABLE',
  /**
   * 该用户已有一笔待付占位未结。**这条闸是"同时至多一笔"**，所以第二次请求必须
   * 能续付而不是撞死：响应体要附上那笔的 `checkoutUrl` 与 `expiresAt`。
   * 没有它，一个付费账号就能对 Feed 里每条处女地免费提交一次"下单"再关掉标签页，
   * 把整网反复遮黑 45 分钟（10 §4.5b）。
   */
  STEALTH_LOCK_PENDING: 'STEALTH_LOCK_PENDING',
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
