import {
  runDailyPipeline,
  discoverSources,
  generateDiscoveryIntents,
  validateDiscoveryIntents,
  generateExperimentCards,
  assessCommercialOpportunities,
  renderCommercialAssessment,
  TrackRecordService,
  PredictionEpisodeService,
  SubscriptionLifecycleService,
  ProjectService,
  YieldGuardService,
  OutputGuaranteeService,
  RecomputeService,
  ingestExternalDemand,
  seedKeywordCandidates,
  retryStripeAttributions,
} from '@emeradar/services';
import { query } from '@emeradar/db';

/**
 * 全部后台任务的**唯一定义**。
 *
 * 这些任务此前只有一种执行方式：命令行。于是"任务是什么"散落在 `cli.ts` 的
 * if-else 链里，而"任务什么时候跑"在宿主机 crontab 里，"失败了怎么办"根本没有
 * 地方——三份描述同一个任务的东西，各自都会漂移。改成队列消费之后必须有一处
 * 同时说清这三件事，否则就是第四份副本。
 *
 * 所以：`command` 既是队列名，也是手工执行时的子命令名。运维看到告警里写着
 * `run-daily`，他要敲的命令就是 `run-daily`，不需要再查一次映射表。
 */
export interface TaskSpec {
  /** 队列名 = CLI 子命令名。 */
  command: string;
  /** cron 表达式（UTC）；`null` 表示只手工触发，不排期。 */
  cron: string | null;
  /** 给人看的一句话说明，出现在启动日志和告警邮件里。 */
  description: string;
  /**
   * 失败重试次数。`0` 表示失败即终局：这类任务重试没有意义，只会把同一个错误
   * 拖长，必须立刻有人看到（`verify-ledger` 就是这种——账本对不上不会因为再跑
   * 一次就对得上）。
   */
  retryLimit: number;
  retryDelaySeconds: number;
  /** 单次执行的最长时间。超时后 pg-boss 把任务标记为失败并按重试策略处理。 */
  expireInSeconds: number;  /**
   * 连续失败几次就该发告警邮件。默认 2：一次失败可能是网络抖动，两次说明它不会
   * 自己好。`verify-ledger` 用 1，因为它的失败是账本不可信，不是可重试的故障。
   */
  alertAfterFailures: number;
  /**
   * 执行体。**失败必须抛出**，不能只写日志或设 `process.exitCode`：常驻进程里
   * 设置退出码不会让当前这次任务失败，却会在进程最终退出时带出一个失败码，
   * 让 `restart: unless-stopped` 把整个 worker 重启一遍——一次数据问题变成一次
   * 全员停机。
   */
  run(args: string[], context: TaskContext): Promise<void>;
}

export interface TaskContext {
  /** 谁在执行：手工命令行（`cli`）还是队列消费（`queue`）。会落进 `pipeline_runs` 的元数据。 */
  trigger: 'cli' | 'queue';
  /** pg-boss preserves createdOn across retries, including retries after midnight. */
  scheduledAt?: Date;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 任务所属的当日 `obs_date`。
 *
 * Queue work uses the persisted job creation time, which pg-boss carries across
 * retries. CLI work defaults to today; an explicit observation date wins.
 */
export function scheduledDate(args: string[], context?: TaskContext): string {
  return args[0] || context?.scheduledAt?.toISOString().slice(0, 10) || today();
}

export const TASKS: TaskSpec[] = [
  {
    command: 'retry-stripe-attributions',
    cron: '10 * * * *',
    description: '重试 Stripe 订阅归因；不安全的历史支付事件留待人工对账',
    retryLimit: 1,
    retryDelaySeconds: 300,
    expireInSeconds: 900,
    alertAfterFailures: 1,
    async run() {
      const result = await retryStripeAttributions();
      console.log('[task] Stripe reconciliation:', result);
      if (result.failed) throw new Error(`${result.failed} Stripe events require manual reconciliation`);
    },
  },
  {
    command: 'run-daily',
    cron: '30 3 * * *',
    description: '每日管线：采集 → 观测 → 裁决 → 账本 → 告警（S6 单写入者）',
    retryLimit: 1,
    retryDelaySeconds: 600,
    expireInSeconds: 3600,
    alertAfterFailures: 2,
    async run(args, context) {
      const date = scheduledDate(args, context);
      console.log(`[task] run-daily for ${date}`);
      const result = await runDailyPipeline(date, context.trigger);
      console.log('[task] pipeline result:', result);
      // 结算到期预测：管线刚提交完当日裁决，公开战绩应当同步跟上。
      const outcomes = await PredictionEpisodeService.evaluateDueEpisodes(date);
      console.log('[task] episode outcomes:', outcomes);
      // 计费状态按天收敛。权益本身已经 fail-closed（读侧 JOIN 自己执行宽限期），
      // 这一步是让**存储的状态**追上它，见 sweepExpiredSubscriptions 的说明。
      const swept = await SubscriptionLifecycleService.sweepExpiredSubscriptions();
      console.log('[task] subscription sweep:', swept);
    },
  },
  {
    command: 'seed-keywords',
    cron: '20 3 * * *',
    description: '选题入口：工具意图种子 → Google 长尾词 → 新候选（词量只做入口筛选，不进评分）',
    retryLimit: 1,
    retryDelaySeconds: 300,
    expireInSeconds: 900,
    alertAfterFailures: 2,
    async run(args, context) {
      const result = await seedKeywordCandidates(scheduledDate(args, context));
      console.log('[task] keyword seed result:', result);
      if (!result.skipped && result.failures === result.seeds.length && result.seeds.length > 0) {
        throw new Error(`所有种子请求都失败了（${result.failures}/${result.seeds.length}）`);
      }
    },
  },
  {
    command: 'discover',
    cron: '45 3 * * *',
    description: '采集源信号（RSS / autocomplete）',
    retryLimit: 2,
    retryDelaySeconds: 300,
    expireInSeconds: 1800,
    alertAfterFailures: 2,
    async run() {
      const result = await discoverSources();
      console.log('[task] discovery result:', result);
      // 全部采集源都失败才算这次任务失败；部分失败已在结果里，不算。
      if (result.sources > 0 && result.failed === result.sources) {
        throw new Error(`所有采集源都失败了（${result.failed}/${result.sources}）`);
      }
    },
  },
  {
    command: 'generate-intents',
    cron: '0 4 * * *',
    description: '从未验证假设池生成意图假设',
    retryLimit: 2,
    retryDelaySeconds: 300,
    expireInSeconds: 1800,
    alertAfterFailures: 2,
    async run(args) {
      const limit = clamp(args[0], 100, 1, 500);
      const created = await generateDiscoveryIntents(limit);
      console.log(`[task] generated ${created} unverified intent hypotheses`);
    },
  },
  {
    command: 'validate-intents',
    cron: '15 4 * * *',
    description: '用 LLM 验证意图假设（花预算）',
    retryLimit: 2,
    retryDelaySeconds: 300,
    expireInSeconds: 1800,
    alertAfterFailures: 2,
    async run(args) {
      const limit = clamp(args[0], 5, 1, 20);
      const validated = await validateDiscoveryIntents(limit);
      console.log(`[task] validated ${validated} discovery intent hypotheses`);
    },
  },
  {
    command: 'generate-experiments',
    cron: '30 4 * * *',
    description: '生成早期实验卡片',
    retryLimit: 2,
    retryDelaySeconds: 300,
    expireInSeconds: 1800,
    alertAfterFailures: 2,
    async run(args) {
      const created = await generateExperimentCards(clamp(args[0], 20, 1, 200));
      console.log(`[task] generated ${created} early experiment cards`);
    },
  },
  {
    command: 'sync-gsc',
    cron: '0 5 * * *',
    description: '拉取 Search Console 指标（逐项目，单个失败不拖垮全部）',
    retryLimit: 2,
    retryDelaySeconds: 600,
    expireInSeconds: 1800,
    alertAfterFailures: 2,
    async run(args) {
      const days = clamp(args[0], 30, 1, 90);
      // GSC 数据有 2 天的滞后期，所以窗口终点取前天，否则最后两天永远是空的。
      const end = new Date();
      end.setUTCDate(end.getUTCDate() - 2);
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - days + 1);
      const projects = await query<{ id: string; user_id: string }>(
        `SELECT p.id, p.user_id FROM projects p
           JOIN gsc_connections g ON g.project_id = p.id
          WHERE p.project_kind IN ('FORMAL','EXPERIMENT')
            AND p.status <> 'ARCHIVED'
            AND g.property_url IS NOT NULL`
      );
      let synced = 0;
      const failures: string[] = [];
      for (const project of projects.rows) {
        try {
          const result = await ProjectService.syncGscProject(
            project.id,
            project.user_id,
            start.toISOString().slice(0, 10),
            end.toISOString().slice(0, 10)
          );
          synced++;
          console.log(`[task] synced ${project.id}: ${result.count} detail rows`);
        } catch (error) {
          failures.push(project.id);
          console.error(`[task] GSC sync failed for ${project.id}:`, error);
        }
      }
      console.log(`[task] GSC sync complete: ${synced}/${projects.rows.length} projects`);
      if (failures.length > 0) {
        throw new Error(`GSC sync failed for ${failures.length}/${projects.rows.length} projects: ${failures.join(', ')}`);
      }
    },
  },
  {
    command: 'evaluate-episodes',
    cron: '0 6 * * *',
    description: '结算到期预测（独立于 run-daily 排期，作为它的兜底）',
    retryLimit: 2,
    retryDelaySeconds: 300,
    expireInSeconds: 1800,
    alertAfterFailures: 2,
    async run(args, context) {
      const date = scheduledDate(args, context);
      const outcomes = await PredictionEpisodeService.evaluateDueEpisodes(date);
      console.log('[task] episode outcomes:', outcomes);
    },
  },
  {
    command: 'sweep-subscriptions',
    cron: '15 6 * * *',
    description: '取消超过宽限期的 PAST_DUE 订阅并回收告警额度',
    retryLimit: 2,
    retryDelaySeconds: 300,
    expireInSeconds: 900,
    alertAfterFailures: 2,
    async run(args) {
      const graceDays = clamp(args[0], 7, 1, 90);
      const swept = await SubscriptionLifecycleService.sweepExpiredSubscriptions(graceDays);
      console.log(`[task] sweep complete: ${swept.canceled.length} cancelled of ${swept.scanned} due`);
      if (swept.canceled.length > 0) console.log('[task] cancelled users:', swept.canceled);
    },
  },
  {
    command: 'verify-ledger',
    cron: '0 7 * * *',
    description: '验证最新账本检查点（失败即 P0，不重试）',
    // 不重试：账本对不上不会因为再跑一次就对得上，重试只会把"发现"推迟。
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 900,
    alertAfterFailures: 1,
    async run(args) {
      // 不给日期就验**最新**那一条，而不是"今天"。
      //
      // 账本只在有裁决的日子才推进，所以"今天没有检查点"是常态（尤其是刚上线、
      // 或当天没有机会进入 TRACKED 时），它**不是**故障。按今天去验会在每个这样的
      // 晚上抛错，然后按 P0 发一封假告警——P0 通道一旦开始说假话，真话也就没人看了。
      // 名字里带日期则照旧：运维点名要验哪一天，那天不存在就该报错。
      const date = args[0] || (await TrackRecordService.latestCheckpointDate());
      if (!date) {
        console.log('[task] 账本还没有任何检查点，没有可验证对象（不是通过，也不是失败）');
        return;
      }
      const verification = await TrackRecordService.verifyCheckpoint(date);
      console.log('[task] verification result:', verification);
      if (!verification.verified) {
        throw new Error(
          `检查点校验失败：${date} 的默克尔根与底层裁决不一致（存储 ${verification.storedMerkleRoot} / 重算 ${verification.calculatedMerkleRoot}，${verification.rowCount} 行）`
        );
      }
      console.log(`[task] ${date} 的检查点与全部底层裁决一致`);
    },
  },
  {
    command: 'ingest-external-demand',
    // 在 evaluate-episodes（06:00）之前，评估读到的是当日写入的序列。
    cron: '30 5 * * *',
    description: '写入 ev-1.1 外部结果事件的词量与 Trends 序列（未配置凭证时跳过，不写占位值）',
    retryLimit: 2,
    retryDelaySeconds: 600,
    expireInSeconds: 1800,
    alertAfterFailures: 2,
    async run(args, context) {
      const result = await ingestExternalDemand(scheduledDate(args, context));
      console.log(`[task] external demand: ${JSON.stringify(result)} (trigger=${context.trigger})`);
      // 部分失败必须让任务失败，才会进重试与告警；整体跳过（没配凭证）不算失败。
      if (!result.skipped && result.failures > 0) {
        throw new Error(`external demand ingest had ${result.failures} failed request(s)`);
      }
    },
  },
  {
    command: 'apply-output-guarantee',
    // 在 check-yield（07:50）之后：先让 Admin 看到告警，再执行补偿。
    cron: '55 7 * * *',
    description: '兜底承诺：连续 14 天零合格 BUILD_NOW/EARLY_BET 时，活跃 Pro 订阅自动延长 7 天（只给时长，不退现金）',
    retryLimit: 2,
    retryDelaySeconds: 300,
    expireInSeconds: 900,
    alertAfterFailures: 2,
    async run(args, context) {
      const result = await OutputGuaranteeService.check(scheduledDate(args, context));
      console.log(`[task] output guarantee: ${JSON.stringify(result)} (trigger=${context.trigger})`);
    },
  },
  {
    command: 'recompute-sample',
    cron: '10 8 * * *',
    description: '抽样 1% 历史 Verdict 用封存输入重算并比对账本（不一致即严重告警，不重试）',
    // 与 verify-ledger 同理：不一致不会因为再跑一次就一致，重试只会推迟发现。
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 900,
    alertAfterFailures: 1,
    async run(args, context) {
      const result = await RecomputeService.sample(scheduledDate(args, context));
      console.log(`[task] recompute sample: ${result.sampled} sampled, ${result.mismatches.length} mismatched (trigger=${context.trigger})`);
      if (result.mismatches.length > 0) {
        throw new Error(
          `重算与账本不一致（快照被污染或代码非确定）：${JSON.stringify(
            result.mismatches.map((m) => ({ opp: m.opportunityId, date: m.obsDate, fields: m.diffs.map((d) => d.field) }))
          )}`
        );
      }
    },
  },
  {
    command: 'check-yield',
    // 排在 run-daily（03:30）与全部写库作业之后，读到的是当日最终的账本。
    cron: '50 7 * * *',
    description: '产出守卫：7 天无新增或 BUILD_NOW 占比超限时只给 Admin 发告警（不改配置）',
    retryLimit: 2,
    retryDelaySeconds: 300,
    expireInSeconds: 900,
    alertAfterFailures: 2,
    async run(args, context) {
      const result = await YieldGuardService.check(scheduledDate(args, context));
      console.log(
        `[task] yield guard: new=${result.newPublishedInWindow} floor=${result.floorBreached} ceiling=${result.ceilingBreached} (trigger=${context.trigger})`
      );
    },
  },
  {
    command: 'assess-commercial',
    // 只读报表，不排期：它是给人看的，不是给调度跑的。
    cron: null,
    description: '重算 M 轴分档（只读，不写库）',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 900,
    alertAfterFailures: 2,
    async run(args, context) {
      const date = scheduledDate(args, context);
      const report = await assessCommercialOpportunities(date);
      console.log(renderCommercialAssessment(report));
    },
  },
];

export function findTask(command: string): TaskSpec | undefined {
  return TASKS.find((t) => t.command === command);
}

function clamp(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
