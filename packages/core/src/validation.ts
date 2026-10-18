import { z } from 'zod';
import { AppError } from './errors';
import { BuildArchetype } from './enums';

/**
 * Request-body validation shared by the HTTP layer.
 *
 * Every route that accepts structured input runs its body through a schema here
 * before touching a service. Without it, a wrong-typed field (an array where a
 * string is expected, a number where a date is expected) reaches SQL and fails
 * as an opaque 500 instead of a 400 naming the offending field.
 *
 * Schemas are deliberately strict about types and shape but permissive about
 * optional fields, so partial updates keep working.
 */

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters.').max(200);
export const displayNameSchema = z.string().trim().min(1).max(80);

export const localeSchema = z.enum(['en-US', 'zh-CN']);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});

export const checkoutSchema = z.object({
  planCode: z.enum(['PRO', 'TEAM']),
  billingCycle: z.enum(['monthly', 'yearly', 'lifetime']).default('yearly'),
  returnUrl: z.string().max(2048).optional(),
});

export const scanSchema = z.object({
  query: z.string().trim().min(2, 'Query must be at least 2 characters long.').max(120),
  marketCountry: z.string().trim().length(2).optional(),
  language: z.string().trim().max(10).optional(),
  archetype: z.nativeEnum(BuildArchetype).optional(),
});

/**
 * POST /decisions records the user's GO or PASS on a tracked opportunity.
 *
 * `verdictId` is required, and it is the caller's — not the server's — that
 * names the verdict. The service used to pick "the latest verdict for this
 * opportunity", which meant a decision could be filed against a ledger row the
 * user had never seen: the rendered page and the recorded citation were chosen
 * independently, and nothing could tell them apart afterwards.
 */
export const decisionSchema = z.object({
  opportunityId: z.string().trim().min(1).max(200),
  verdictId: z.string().trim().min(1).max(200),
  /**
   * 只收意见（PASS）。GO 必须走 `POST /opportunities/{id}/go`：它扣配额、建 Project、
   * 授权点火包，三者同生共死。这个端点收下 GO 就等于开了一条不扣配额、不建项目的
   * 旁路（01 §1.8 第 5 条、ADR-018）。
   */
  decision: z.literal('PASS'),
  reasons: z.array(z.string().max(500)).max(20).optional(),
});

export const alertRuleSchema = z.object({
  opportunityId: z.string().trim().min(1).max(200),
  /**
   * 首发 6 条里用户可订阅的类型（docs/12 §2、01 F9）。
   *
   * `NEW_ENTRANT` 是 Phase 2 的 NEW_AUTHORITATIVE_ENTRANT，不在这里；旧的槽位触发器
   * 已随 v3.1 的槽位一起删除，由 `CROWDING_SIGNAL` 取代。`CROWDING_SIGNAL` 目前
   * 只有枚举与求值骨架、没有数据生产者，创建时会被服务层 400 拒绝（E3）。
   */
  ruleType: z.enum(['VERDICT_CHANGE', 'WINDOW_CLOSING', 'KILL_CRITERIA', 'CROWDING_SIGNAL']),
  frequency: z.enum(['IMMEDIATE', 'DAILY', 'WEEKLY']).optional(),
});

/**
 * Shape-only validation for **experiment** projects, the one remaining kind this
 * endpoint may create.
 *
 * An opportunity project no longer has a creation endpoint of its own: it is a
 * side effect of `POST /opportunities/{id}/go`, inside the same transaction that
 * claims the slot and spends the quota (ADR-018, 10 §4.3). `opportunityId` stays
 * in the schema purely so the route can answer a caller who still sends it with
 * a sentence pointing at the right endpoint, instead of a generic validation
 * error. `decisionId` is gone: nothing accepts a caller-chosen decision any
 * more, because the decision is written by the GO transaction itself.
 */
export const projectCreateSchema = z.object({
  opportunityId: z.string().trim().min(1).max(200).optional(),
  experimentCardId: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(253).optional(),
  buildType: z.nativeEnum(BuildArchetype).optional(),
  targetKeywords: z.array(z.string().trim().max(200)).max(200).optional(),
});

/** 凭证类型与 09 §8 的三类一一对应（03 §12 `project_credentials.credential_type`）。 */
export const credentialTypeSchema = z.enum(['DOMAIN_URL', 'STORE_LISTING_URL', 'PUBLIC_PAGE_URL']);

/**
 * 原子 GO 的请求体（10 §4.3）。
 *
 * `archetype` 必填：这条机会要按哪个形态落地是用户的选择，服务端不替他挑。
 * 这里**没有** `credential`：v3.1 的凭证核验是 GO 之后的可选动作，走
 * `POST /projects/{id}/credentials`（阶段 C 由 stake 路由改名而来），失败不释放
 * 资源、不退配额。
 */
export const goSchema = z.object({
  archetype: z.nativeEnum(BuildArchetype),
  verdictId: z.string().trim().min(1).max(200),
  reportId: z.string().trim().max(200).optional(),
});

/** 上线凭证（09 §8、10 §4.5）。v3.1 里它是 GO 之后的可选动作，没有截止时间。 */
export const credentialSchema = z.object({
  credentialType: credentialTypeSchema,
  url: z.string().trim().url().max(2000),
});

export const preferencesSchema = z.object({
  uiLocale: localeSchema.optional(),
  preferredMarkets: z.array(z.string().trim().length(2)).max(50).optional(),
  preferredBuildTypes: z.array(z.string().trim().max(60)).max(20).optional(),
  // TEXT with a CHECK constraint in the database, not a number of hours.
  preferredTimeBudget: z.enum(['WEEKEND', 'TWO_WEEKS', 'ONE_MONTH']).nullable().optional(),
  topics: z.array(z.string().trim().max(80)).max(50).optional(),
  onboardingCompleted: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/** Consuming a one-time reset token (admin-initiated resets use `resetPasswordSchema`). */
export const passwordResetSchema = z.object({
  token: z.string().trim().min(1).max(500),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(1).max(500),
});

/** The comparison view shows at most three opportunities side by side. */
export const compareSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(200)).min(2).max(3),
});

export const candidateModerateSchema = z.object({
  opportunityId: z.string().trim().min(1).max(200),
  action: z.enum(['ARCHIVE', 'PROMOTE_TO_TRACKED']),
});

export const pipelineTriggerSchema = z.object({
  task: z.enum(['discover', 'generate-intents', 'validate-intents', 'run-daily']),
});

export const adminSourceSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('toggle'),
    sourceId: z.string().trim().min(1).max(200),
    isActive: z.boolean(),
  }),
  z.object({
    action: z.literal('add'),
    name: z.string().trim().min(1).max(200),
    // Only http(s): the URL is fetched by the worker, and a `file:`/`javascript:`
    // feed URL is never legitimate.
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => /^https?:\/\//i.test(value), 'Feed URL must start with http:// or https://'),
  }),
]);

/** Daily rows come from the Search Console API; weekly rows are self-reported. */
const gscDailyRowSchema = z.object({
  date: z.string().trim().min(8).max(40),
  page: z.string().trim().max(2048).optional(),
  query: z.string().trim().max(500).optional(),
  impressions: z.coerce.number().int().min(0),
  clicks: z.coerce.number().int().min(0),
  position: z.coerce.number().min(0).optional(),
});

const gscWeeklyRowSchema = z.object({
  weekStartDate: z.string().trim().min(8).max(40),
  pageUrl: z.string().trim().max(2048).optional(),
  query: z.string().trim().max(500).optional(),
  impressions: z.coerce.number().int().min(0),
  clicks: z.coerce.number().int().min(0),
  averagePosition: z.coerce.number().min(0).optional(),
  source: z.enum(['GSC', 'SELF_REPORTED']).optional(),
});

export type GscDailyRowInput = z.infer<typeof gscDailyRowSchema>;
export type GscWeeklyRowInput = z.infer<typeof gscWeeklyRowSchema>;

/**
 * A sync body is all-daily or all-weekly, never mixed: the route picks the
 * ingest path from the row shape, so a mixed array would silently drop rows.
 * The union rejects it with a 400 instead.
 */
export const gscSyncSchema = z.union([
  z.object({ rows: z.array(gscDailyRowSchema).min(1).max(50_000) }),
  z.object({ rows: z.array(gscWeeklyRowSchema).min(1).max(50_000) }),
]);

export type GscSyncInput =
  | { kind: 'daily'; rows: GscDailyRowInput[] }
  | { kind: 'weekly'; rows: GscWeeklyRowInput[] };

/** Parses a GSC sync body and tags which ingest path it belongs to. */
export function parseGscSyncInput(input: unknown): GscSyncInput {
  const parsed = parseInput(gscSyncSchema, input);
  return 'date' in (parsed.rows[0] as Record<string, unknown>)
    ? { kind: 'daily', rows: parsed.rows as GscDailyRowInput[] }
    : { kind: 'weekly', rows: parsed.rows as GscWeeklyRowInput[] };
}

export const gscPropertySchema = z.object({
  // Either a URL-prefix property (`https://example.com/`) or a domain property
  // (`sc-domain:example.com`).
  propertyUrl: z.string().trim().min(1).max(2048),
});

export const projectUpdateSchema = z.object({
  status: z.enum(['IN_DEVELOPMENT', 'LAUNCHED', 'ARCHIVED']).optional(),
  domain: z.string().trim().min(1).max(253).optional(),
  propertyUrl: z.string().trim().min(1).max(2048).optional(),
});

export const billingSessionSchema = z.object({
  sessionId: z.string().trim().min(1).max(300),
});

export const apiKeyCreateSchema = z.object({
  label: z.string().trim().max(60).optional(),
  scopes: z.array(z.string().trim().max(60)).max(20).optional(),
});

export const adminUserUpdateSchema = z.object({
  role: z.enum(['USER', 'ANALYST', 'ADMIN', 'SUPPORT']).optional(),
  tier: z.enum(['FREE', 'PRO', 'TEAM']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
});

export const adminUserCreateSchema = z.object({
  email: emailSchema,
  password: passwordSchema.optional(),
  displayName: displayNameSchema.optional(),
  role: z.enum(['USER', 'ANALYST', 'ADMIN', 'SUPPORT']).optional(),
  tier: z.enum(['FREE', 'PRO', 'TEAM']).optional(),
});

/** An admin may omit the password and let the server generate a temporary one. */
export const resetPasswordSchema = z.object({
  password: passwordSchema.optional(),
});

/**
 * Parses `input`, throwing a 400 `AppError` that names each offending field.
 * Route handlers can therefore let validation errors propagate to their normal
 * error translation instead of duplicating checks.
 */
export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(body)',
    message: issue.message,
  }));
  throw AppError.badRequest(
    `Invalid request body: ${errors.map((e) => `${e.path} — ${e.message}`).join('; ')}`,
    errors
  );
}

export { z };
