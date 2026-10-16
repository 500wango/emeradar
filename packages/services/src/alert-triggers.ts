/**
 * 告警触发器的求值。
 *
 * 只做一件事：给定一条规则类型和当日/前一日的裁决事实，回答"这条规则今天该不该
 * 触发"。做成纯函数是为了能直接测 —— 它跑在每日流水线的账本事务里，而本地环境
 * 跑不出可发布的观测（`publishable` 恒为空），端到端根本走不到这里。
 *
 * ## 与 docs/12 的关系
 *
 * docs/12 §2 定义的是内置触发器，用户在规则里**订阅触发器的组合**；而这里实现的
 * 是旧的按 `alert_rules.rule_type` 单值订阅的模型，两者不是同一套东西。本模块只
 * 实现**能确定性求值**的类型：判据要么完全来自账本里的 verdict，要么来自当日与
 * 7 天前的 SERP 快照。其余类型在 `AlertService.createAlertRule` 被显式拒绝 ——
 * 让用户订阅一个永远不会触发的规则，比不提供这个选项更糟。
 */

/** 当日与对照日的 SERP Top10，供 `NEW_ENTRANT` 使用。 */
export interface SerpEntrantRow {
  rank: number;
  domain: string;
  /** `serp_results.result_type`。 */
  resultType: string;
}

export interface SerpEntrantSnapshot {
  /** 当日的 Top10。 */
  today: SerpEntrantRow[];
  /** 观测日不晚于 `obsDate - 7` 的最近一份 Top10，用作"是否为新进入"的对照。 */
  prior: SerpEntrantRow[];
}

/** 求值所需的全部事实，全部来自已落库的数据，不引入额外外部读取。 */
export interface AlertFacts {
  /** 当日已落账的裁决（不是去抖前的 raw_verdict）。 */
  verdict: string;
  /** 前一日的裁决；没有历史时为 null。 */
  previousVerdict: string | null;
  /** 仅 `NEW_ENTRANT` 需要。缺失时该类型返回 `null`（无法求值），而不是猜一个答案。 */
  serpEntrants?: SerpEntrantSnapshot;
  /**
   * 仅 `KILL_CRITERIA` 需要：该机会是否有任一 ACTIVE 的止损谓词今天求值为真。
   * `null`/缺失表示今天没有可求值的谓词或指标，不是"没触发"。
   */
  killTriggered?: boolean | null;
  /**
   * 仅 `SLOTS_LAST_ONE` 需要：某一形态剩余可认领槽位恰为 1 且近期尚未提醒过。
   * `null`/缺失表示没有槽位数据，不是"没有最后一席"。
   */
  slotsLastOne?: boolean | null;
}

export type AlertRuleType =
  | 'VERDICT_CHANGE'
  | 'WINDOW_CLOSING'
  | 'NEW_ENTRANT'
  | 'KILL_CRITERIA'
  | 'SLOTS_LAST_ONE';

/** 目前真正会被求值的规则类型。其余在创建规则时就被拒绝。 */
export const EVALUATED_RULE_TYPES = ['VERDICT_CHANGE', 'WINDOW_CLOSING', 'NEW_ENTRANT', 'KILL_CRITERIA', 'SLOTS_LAST_ONE'] as const;

/** 已被拒绝创建的类型 → 拒绝理由（给人看的中文说明，用于 400 detail）。 */
export const UNIMPLEMENTED_RULE_TYPES: Record<string, string> = {};

/**
 * 判为"权威"的结果类型（docs/12 §2 的 NEW_AUTHORITATIVE_ENTRANT）。
 *
 * `OFFICIAL` 是产品方自己的官网进场，`EDITORIAL_MEDIA` 是媒体/编辑内容进场 ——
 * 两者都意味着竞争格局在变强。
 *
 * 词汇来自 `serp_results.result_type`（`packages/scoring/src/types.ts` 的
 * `ResultType`）。**这是结果类型，不是 `domain_authority_class`** —— 后者是
 * HIGH_AUTHORITY_GENERIC（维基/亚马逊这类泛权威）一类的域名分级，检出的是另一个
 * 信号。两者不可互相顶替。
 *
 * 文档曾写作 `MAJOR_MEDIA`，代码里没有这个取值；规范拼写是 `EDITORIAL_MEDIA`。
 */
export const AUTHORITATIVE_RESULT_TYPES = ['OFFICIAL', 'EDITORIAL_MEDIA'] as const;

export interface AuthoritativeEntrant {
  domain: string;
  rank: number;
  resultType: string;
}

export function isEvaluatedRuleType(ruleType: string): boolean {
  return (EVALUATED_RULE_TYPES as readonly string[]).includes(ruleType);
}

/**
 * 当日 Top10 是否新出现了一个权威域名。
 *
 * 两个条件缺一不可（docs/12 §2）：
 *   1. 该域名当日进入 Top10，且结果类型属于权威类；
 *   2. 该域名在 7 天前的 Top10 里**完全未出现** —— 上一轮就在榜上的权威不是"新进入"，
 *      每天为同一批媒体重复告警会把这条规则变成噪声。
 *
 * 返回排名最高的那个供通知正文指名；无则返回 null。
 */
export function detectNewAuthoritativeEntrant(
  snapshot: SerpEntrantSnapshot,
  authoritativeTypes: readonly string[] = AUTHORITATIVE_RESULT_TYPES
): AuthoritativeEntrant | null {
  const priorDomains = new Set(snapshot.prior.map((row) => row.domain));
  const entrant = snapshot.today
    .filter((row) => authoritativeTypes.includes(row.resultType))
    .filter((row) => !priorDomains.has(row.domain))
    .sort((a, b) => a.rank - b.rank)[0];

  return entrant ? { domain: entrant.domain, rank: entrant.rank, resultType: entrant.resultType } : null;
}

/**
 * 这条规则今天该不该触发。无法求值的调用返回 `null`（调用方必须显式处理，
 * 不能把它当成 false 悄悄吞掉）。
 */
export function evaluateAlertTrigger(ruleType: string, facts: AlertFacts): boolean | null {
  switch (ruleType) {
    case 'VERDICT_CHANGE':
      // docs/12 §2：当日 verdict ≠ 前一日 verdict。首次观测没有前一日，不触发 ——
      // 那不是"变化"，只是第一次看见。
      return facts.previousVerdict !== null && facts.previousVerdict !== facts.verdict;

    case 'WINDOW_CLOSING':
      // docs/12 §2 的 WINDOW_CLOSING_ENTERED：当日 verdict = WINDOW_CLOSING 且
      // 前一日不是。只在"进入"那一刻触发一次，而不是窗口关着的每一天都响。
      return facts.verdict === 'WINDOW_CLOSING' && facts.previousVerdict !== 'WINDOW_CLOSING';

    case 'NEW_ENTRANT':
      // 没有 SERP 快照就返回 null 而不是 false："没有数据"与"没有新进入者"是两件事，
      // 后者会被用户读成"竞争格局没变"。
      if (!facts.serpEntrants) return null;
      return detectNewAuthoritativeEntrant(facts.serpEntrants) !== null;

    case 'KILL_CRITERIA':
      // 谓词由 `@emeradar/scoring` 的 `evaluateKillPredicate` 求值；这里只接收结论。
      return facts.killTriggered ?? null;

    case 'SLOTS_LAST_ONE':
      return facts.slotsLastOne ?? null;

    default:
      return null;
  }
}
