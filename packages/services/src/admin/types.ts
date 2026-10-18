export interface AdminUserListItem {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT';
  tier: 'FREE' | 'PRO' | 'TEAM';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  createdAt: string;
  updatedAt: string;
  projectsCount: number;
  alertsCount: number;
  apiKeysCount: number;
  /**
   * The plan that actually applies, resolved by the same predicate every quota
   * check uses — `'FREE'` when nothing backs it, never `null` and never a stale
   * row's code.
   *
   * It used to be the latest `subscriptions` row regardless of status, so a
   * cancelled PRO subscription still displayed as PRO here while the rest of the
   * product had already dropped the account to FREE. The admin surface is where
   * an operator decides whether someone is paying, so it is the last place that
   * can afford a second opinion about the plan.
   */
  subscriptionPlanCode: string;
  /**
   * Whether a subscription currently grants entitlements — which includes the
   * `PAST_DUE` grace window, because during it the account is still served. It is
   * deliberately not "status = ACTIVE": that reading would mark a customer whose
   * card failed yesterday as unsubscribed while they still have full access.
   */
  hasActiveSubscription: boolean;
}

export interface AdminUserStats {
  totalUsers: number;
  activeUsers: number;
  paidUsers: number;
  staffUsers: number;
}

export interface AdminPipelineOverview {
  opportunityStats: {
    tracked: number;
    candidate: number;
    archived: number;
    total: number;
  };
  costTodayUsd: number;
  dailyBudgetLimitUsd: number;
  latestCheckpoint: {
    obsDate: string;
    merkleRoot: string;
    totalRecords: number;
    /**
     * 检查点**写入**的时刻，不是校验时刻。底层的 `ledger_checkpoints.verified_at`
     * 列只由 `DEFAULT NOW()` 填充，从没有任何代码在写入前校验过它 —— 名字是错的。
     * 真实的校验结果是同一对象里的 `recomputed`。
     */
    recordedAt: string;
    /**
     * 拿库里存的行重算这一天的结果。
     *
     * `null` 表示**重算没跑成**（与 `verified: false` 的"跑通了但对不上"是两回事，
     * 页面必须分开显示 —— 把"不知道"渲染成"通过"正是这块面板原先的问题）。
     */
    recomputed: {
      verified: boolean;
      /** 重算出的默克尔根；与 `merkleRoot` 不等时页面可直接并排显示。 */
      calculatedMerkleRoot: string;
      /** 实际参与重算的行数；与 `totalRecords` 不等本身就是证据缺口。 */
      rowCount: number;
    } | null;
  } | null;
  recentCollectorRuns: Array<{
    id: string;
    sourceId: string;
    sourceName: string;
    status: string;
    itemsCollected: number;
    startedAt: string;
    finishedAt: string | null;
    errorMessage: string | null;
  }>;
  recentStaleEvents: Array<{
    id: string;
    obsDate: string;
    opportunityId: string;
    opportunitySlug: string;
    opportunityTitle: string;
    source: 'AUTOCOMPLETE' | 'SERP' | 'COMMERCIAL';
    domain: string;
    referenceId: string | null;
    observedAt: string | null;
  }>;
  latestDiscoverySignals: Array<{
    id: string;
    title: string;
    provider: string;
    sourceUrl: string;
    collectedAt: string;
  }>;
  recentPipelineRuns?: Array<{
    id: string;
    obsDate: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    processedOpportunities: number;
    merkleRoot: string | null;
    alertsTriggered: number;
    errorMessage: string | null;
  }>;
}

export interface AdminCandidateItem {
  id: string;
  slug: string;
  title: string;
  primaryQuery: string;
  status: string;
  marketCountry: string;
  researchLanguage: string;
  firstObservedDate: string;
  observationDays: number;
  discoverySource: string | null;
  candidateReason: string | null;
  recommendedArchetype: string;
  executionClass: string;
}

export interface AdminSourceHealth {
  lastRunAt: string | null;
  lastStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED' | null;
  lastError: string | null;
  lastItems: number | null;
  runs24h: number;
  failures24h: number;
  /** 0–1；24h 没有运行时为 0。 */
  failureRate24h: number;
  lastSuccessAt: string | null;
  circuitOpen: boolean;
  circuitOpenUntil: string | null;
}

export interface AdminSourceItem {
  id: string;
  type: string;
  name: string;
  config: Record<string, any>;
  isActive: boolean;
  tosRiskLevel: string;
  createdAt: string;
  health: AdminSourceHealth;
}
