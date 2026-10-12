/**
 * 告警触发器的求值。
 *
 * 只做一件事：给定一条规则类型和当日/前一日的裁决事实，回答"这条规则今天该不该
 * 触发"。做成纯函数是为了能直接测 —— 它跑在每日流水线的账本事务里，而本地环境
 * 跑不出可发布的观测（`publishable` 恒为空），端到端根本走不到这里。
 *
 * ## 与 docs/12 的关系（未对齐，需人工裁决）
 *
 * docs/12 §2 定义的是 8 条**内置触发器**（`VERDICT_CHANGED`、`LIFECYCLE_CHANGED`、
 * `WINDOW_CLOSING_ENTERED`、`SERP_WEAKNESS_DROP`、`AUTOCOMPLETE_SPIKE`、
 * `NEW_AUTHORITATIVE_ENTRANT`、`KILL_CRITERIA_TRIGGERED`、`PROJECT_GSC_TRACTION`），
 * 用户在规则里**订阅触发器的组合**；而这里实现的是旧的按 `alert_rules.rule_type`
 * 单值订阅的模型，两者不是同一套东西。
 *
 * 本模块只实现**能确定性求值**的两种（判据完全来自账本里的 verdict 与前一日裁决，
 * 不需要别的数据源）。其余类型在 `AlertService.createAlertRule` 被显式拒绝 ——
 * 让用户订阅一个永远不会触发的规则，比不提供这个选项更糟。
 */

/** 求值所需的全部事实，全部来自账本，不引入额外读取路径。 */
export interface AlertFacts {
  /** 当日已落账的裁决（不是去抖前的 raw_verdict）。 */
  verdict: string;
  /** 前一日的裁决；没有历史时为 null。 */
  previousVerdict: string | null;
}

export type AlertRuleType =
  | 'VERDICT_CHANGE'
  | 'WINDOW_CLOSING'
  | 'NEW_ENTRANT'
  | 'KILL_CRITERIA';

/** 目前真正会被求值的规则类型。其余在创建规则时就被拒绝。 */
export const EVALUATED_RULE_TYPES = ['VERDICT_CHANGE', 'WINDOW_CLOSING'] as const;

/** 已被拒绝创建的类型 → 拒绝理由（给人看的中文说明，用于 400 detail）。 */
export const UNIMPLEMENTED_RULE_TYPES: Record<string, string> = {
  NEW_ENTRANT:
    'NEW_ENTRANT 尚未实现：它需要按 docs/12 §2 的 NEW_AUTHORITATIVE_ENTRANT 语义比对当日 Top10 与 7 天前快照中的域名类别，本系统还没有这条求值路径。',
  KILL_CRITERIA:
    'KILL_CRITERIA 尚未实现：kill_criteria 的谓词 DSL 与其求值函数都还没有落地（docs/12 §5 要求 evaluateKillPredicate 位于 @emeradar/scoring）。',
};

export function isEvaluatedRuleType(ruleType: string): boolean {
  return (EVALUATED_RULE_TYPES as readonly string[]).includes(ruleType);
}

/**
 * 这条规则今天该不该触发。未实现的类型返回 `null`（调用方必须显式处理，
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

    default:
      return null;
  }
}
