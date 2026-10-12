import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  evaluateAlertTrigger,
  isEvaluatedRuleType,
  EVALUATED_RULE_TYPES,
  UNIMPLEMENTED_RULE_TYPES,
} from '../src';

/**
 * 告警触发器的求值口径。
 *
 * 这个模块存在的理由：从前 `alert_rules.rule_type` 放行四种取值，而每日流水线
 * 的 SQL 里写死 `rule_type = 'VERDICT_CHANGE'` —— 用户能建出另外三种规则，它们
 * 永远不会响。这里钉住两件事：(1) 每种取值到底有没有求值路径；(2) 求值的边界
 * 条件（首次观测不算变化、只在"进入"窗口关闭时响一次）。
 */
describe('告警触发器求值', () => {
  it('VERDICT_CHANGE：只有真的变化才触发', () => {
    assert.strictEqual(
      evaluateAlertTrigger('VERDICT_CHANGE', { verdict: 'WINDOW_CLOSING', previousVerdict: 'BUILD_NOW' }),
      true
    );
    assert.strictEqual(
      evaluateAlertTrigger('VERDICT_CHANGE', { verdict: 'BUILD_NOW', previousVerdict: 'BUILD_NOW' }),
      false
    );
    // 首次观测没有前一日。那不是"变化"，只是第一次看见 —— 触发它会让每个
    // 新机会在第一次观测当天就给所有订阅者发一条无意义的通知。
    assert.strictEqual(
      evaluateAlertTrigger('VERDICT_CHANGE', { verdict: 'BUILD_NOW', previousVerdict: null }),
      false
    );
  });

  it('WINDOW_CLOSING：只在进入的那一刻响一次', () => {
    assert.strictEqual(
      evaluateAlertTrigger('WINDOW_CLOSING', { verdict: 'WINDOW_CLOSING', previousVerdict: 'BUILD_NOW' }),
      true
    );
    assert.strictEqual(
      evaluateAlertTrigger('WINDOW_CLOSING', { verdict: 'WINDOW_CLOSING', previousVerdict: 'EARLY_BET' }),
      true
    );
    // 窗口关着的第二天不该再响 —— 那是"持续状态"，不是"进入"。
    assert.strictEqual(
      evaluateAlertTrigger('WINDOW_CLOSING', { verdict: 'WINDOW_CLOSING', previousVerdict: 'WINDOW_CLOSING' }),
      false
    );
    assert.strictEqual(
      evaluateAlertTrigger('WINDOW_CLOSING', { verdict: 'BUILD_NOW', previousVerdict: 'WATCH' }),
      false
    );
  });

  it('未实现的类型返回 null，而不是 false', () => {
    // 返回 false 会被调用方当成"今天不触发"悄悄吞掉，掩盖"根本没有求值路径"
    // 这个事实。null 逼调用方显式处理。
    assert.strictEqual(
      evaluateAlertTrigger('NEW_ENTRANT', { verdict: 'BUILD_NOW', previousVerdict: 'WATCH' }),
      null
    );
    assert.strictEqual(
      evaluateAlertTrigger('KILL_CRITERIA', { verdict: 'BUILD_NOW', previousVerdict: 'WATCH' }),
      null
    );
    assert.strictEqual(
      evaluateAlertTrigger('SOMETHING_NEW', { verdict: 'BUILD_NOW', previousVerdict: 'WATCH' }),
      null
    );
  });

  it('可订阅的类型集合与求值能力一致', () => {
    for (const ruleType of EVALUATED_RULE_TYPES) {
      assert.strictEqual(isEvaluatedRuleType(ruleType), true);
      // 每一个可订阅的类型都必须给出 true/false，而不是 null。
      assert.notStrictEqual(
        evaluateAlertTrigger(ruleType, { verdict: 'WATCH', previousVerdict: 'WATCH' }),
        null,
        `${ruleType} 被标为可订阅，却没有求值实现`
      );
    }
    for (const ruleType of Object.keys(UNIMPLEMENTED_RULE_TYPES)) {
      assert.strictEqual(isEvaluatedRuleType(ruleType), false, `${ruleType} 没有实现却被标为可订阅`);
      assert.ok(UNIMPLEMENTED_RULE_TYPES[ruleType].length > 10, `${ruleType} 缺少可读的拒绝理由`);
    }
  });
});
