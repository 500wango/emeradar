import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CROWDING_VERIFIED_PRODUCT_THRESHOLD,
  detectNewAuthoritativeEntrant,
  evaluateAlertTrigger,
  evaluateCrowdingSignal,
  isEvaluatedRuleType,
  EVALUATED_RULE_TYPES,
  UNIMPLEMENTED_RULE_TYPES,
  SerpEntrantSnapshot,
} from '../src';

/**
 * 告警触发器的求值口径。
 *
 * 这个模块存在的理由：从前 `alert_rules.rule_type` 放行四种取值，而每日流水线
 * 的 SQL 里写死 `rule_type = 'VERDICT_CHANGE'` —— 用户能建出另外三种规则，它们
 * 永远不会响。这里钉住两件事：(1) 每种取值到底有没有求值路径；(2) 求值的边界
 * 条件（首次观测不算变化、只在"进入"窗口关闭时响一次、权威进场的两种否定情形）。
 */
describe('告警触发器求值', () => {
  const baseFacts = { verdict: 'WATCH', previousVerdict: 'WATCH' };
  /** 一个能让 NEW_ENTRANT 真正求值的事实集：有新进入的权威域名（Phase 2 路径）。 */
  const entrantFacts = {
    ...baseFacts,
    killTriggered: false,
    fromCustomQuery: true,
    crowding: {
      verifiedProductCount: 0,
      previousVerifiedProductCount: null,
      newTop10Entrants30d: 0,
      previousNewTop10Entrants30d: null,
    },
    serpEntrants: {
      today: [{ rank: 1, domain: 'acme.com', resultType: 'OFFICIAL' }],
      prior: [{ rank: 4, domain: 'blog.example', resultType: 'SPECIALIST' }],
    },
  };

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

  describe('NEW_ENTRANT：权威域名新进入 Top10', () => {
    const facts = (today: SerpEntrantSnapshot['today'], prior: SerpEntrantSnapshot['prior']) => ({
      ...baseFacts,
      serpEntrants: { today, prior },
    });

    it('当日新出现的权威域名触发', () => {
      assert.strictEqual(
        evaluateAlertTrigger(
          'NEW_ENTRANT',
          facts(
            [{ rank: 3, domain: 'acme.com', resultType: 'OFFICIAL' }],
            [{ rank: 5, domain: 'blog.example', resultType: 'SPECIALIST' }]
          )
        ),
        true
      );
    });

    it('EDITORIAL_MEDIA 同样算权威', () => {
      assert.strictEqual(
        evaluateAlertTrigger(
          'NEW_ENTRANT',
          facts([{ rank: 1, domain: 'forbes.com', resultType: 'EDITORIAL_MEDIA' }], [])
        ),
        true
      );
    });

    it('7 天前就在榜上的权威不是"新进入"', () => {
      // 否则每天都会为同一批媒体重复告警，这条规则就退化成噪声。
      assert.strictEqual(
        evaluateAlertTrigger(
          'NEW_ENTRANT',
          facts(
            [{ rank: 3, domain: 'acme.com', resultType: 'OFFICIAL' }],
            [{ rank: 8, domain: 'acme.com', resultType: 'OFFICIAL' }]
          )
        ),
        false
      );
    });

    it('非权威的结果类型不算，哪怕它是新出现的', () => {
      assert.strictEqual(
        evaluateAlertTrigger(
          'NEW_ENTRANT',
          facts(
            [
              { rank: 2, domain: 'someone.blog', resultType: 'SPECIALIST' },
              { rank: 6, domain: 'offtopic.example', resultType: 'OFF_TOPIC' },
            ],
            []
          )
        ),
        false
      );
    });

    it('缺 SERP 快照时返回 null 而不是 false', () => {
      // false 会被读成"竞争格局没变"，而事实是"今天没有对照组可比"。
      assert.strictEqual(evaluateAlertTrigger('NEW_ENTRANT', baseFacts), null);
    });

    it('返回排名最高的那个进入者，供通知正文指名', () => {
      assert.deepStrictEqual(
        detectNewAuthoritativeEntrant({
          today: [
            { rank: 7, domain: 'forbes.com', resultType: 'EDITORIAL_MEDIA' },
            { rank: 2, domain: 'acme.com', resultType: 'OFFICIAL' },
          ],
          prior: [],
        }),
        { domain: 'acme.com', rank: 2, resultType: 'OFFICIAL' }
      );
      assert.strictEqual(detectNewAuthoritativeEntrant({ today: [], prior: [] }), null);
    });
  });

  describe('CUSTOM_QUERY_PULSE_CONFIRMED：自定义词 7 天脉冲晋升', () => {
    it('自定义词机会首次晋升 BUILD_NOW 时触发', () => {
      assert.strictEqual(
        evaluateAlertTrigger('CUSTOM_QUERY_PULSE_CONFIRMED', {
          verdict: 'BUILD_NOW',
          previousVerdict: 'WATCH',
          fromCustomQuery: true,
        }),
        true
      );
    });

    it('不是自定义词、不是首次晋升、没有来源信息时不触发/不求值', () => {
      assert.strictEqual(
        evaluateAlertTrigger('CUSTOM_QUERY_PULSE_CONFIRMED', {
          verdict: 'BUILD_NOW',
          previousVerdict: 'WATCH',
          fromCustomQuery: false,
        }),
        false
      );
      assert.strictEqual(
        evaluateAlertTrigger('CUSTOM_QUERY_PULSE_CONFIRMED', {
          verdict: 'BUILD_NOW',
          previousVerdict: 'BUILD_NOW',
          fromCustomQuery: true,
        }),
        false
      );
      assert.strictEqual(
        evaluateAlertTrigger('CUSTOM_QUERY_PULSE_CONFIRMED', {
          verdict: 'BUILD_NOW',
          previousVerdict: 'WATCH',
        }),
        null
      );
    });
  });

  it('未知类型返回 null，而不是 false', () => {
    // 返回 false 会被调用方当成"今天不触发"悄悄吞掉，掩盖"根本没有求值路径"
    // 这个事实。null 逼调用方显式处理。
    assert.strictEqual(evaluateAlertTrigger('SOMETHING_NEW', baseFacts), null);
    // KILL_CRITERIA 无可求值的谓词时同样是 null，而不是 false。
    assert.strictEqual(evaluateAlertTrigger('KILL_CRITERIA', baseFacts), null);
    assert.strictEqual(evaluateAlertTrigger('KILL_CRITERIA', { ...baseFacts, killTriggered: true }), true);
    assert.strictEqual(evaluateAlertTrigger('KILL_CRITERIA', { ...baseFacts, killTriggered: false }), false);
  });

  describe('CROWDING_SIGNAL：拥挤度首次跨过阈值（首发；crowding_daily 已有生产者）', () => {
    const crowding = (overrides: Record<string, number | null> = {}) => ({
      verifiedProductCount: 0,
      previousVerifiedProductCount: null,
      newTop10Entrants30d: 0,
      previousNewTop10Entrants30d: null,
      ...overrides,
    });

    it('verified_product_count 首次达到 3 → 触发', () => {
      assert.strictEqual(CROWDING_VERIFIED_PRODUCT_THRESHOLD, 3);
      assert.strictEqual(evaluateCrowdingSignal(crowding({ verifiedProductCount: 3 })), true);
      // 首次观测就 ≥3 也算"首次跨过"，否则这条机会永远不会提醒。
      assert.strictEqual(evaluateCrowdingSignal(crowding({ verifiedProductCount: 5 })), true);
      assert.strictEqual(
        evaluateCrowdingSignal(crowding({ verifiedProductCount: 4, previousVerifiedProductCount: 2 })),
        true
      );
    });

    it('停在 3 或更高不再重复响——它只提示"首次跨过"', () => {
      assert.strictEqual(
        evaluateCrowdingSignal(crowding({ verifiedProductCount: 4, previousVerifiedProductCount: 3 })),
        false
      );
      assert.strictEqual(evaluateCrowdingSignal(crowding({ verifiedProductCount: 2 })), false);
    });

    it('new_top10_entrants_30d 较上次推送增加 → 触发；没有上次读数不算增加', () => {
      assert.strictEqual(
        evaluateCrowdingSignal(crowding({ newTop10Entrants30d: 2, previousNewTop10Entrants30d: 1 })),
        true
      );
      assert.strictEqual(
        evaluateCrowdingSignal(crowding({ newTop10Entrants30d: 1, previousNewTop10Entrants30d: 1 })),
        false
      );
      // 首次观测（没有"上次"）不是变化——与 VERDICT_CHANGE 的"第一次看见不算变化"同源。
      assert.strictEqual(evaluateCrowdingSignal(crowding({ newTop10Entrants30d: 5 })), false);
    });

    it('没有当日数据时返回 null：那是"没法判断"，不是"竞争没加剧"', () => {
      assert.strictEqual(evaluateCrowdingSignal(undefined), null);
      assert.strictEqual(
        evaluateCrowdingSignal(crowding({ verifiedProductCount: null, newTop10Entrants30d: null })),
        null
      );
      assert.strictEqual(evaluateAlertTrigger('CROWDING_SIGNAL', baseFacts), null);
    });

    it('已进入可订阅集合：枚举、EVALUATED 与求值路径一致', () => {
      assert.strictEqual(isEvaluatedRuleType('CROWDING_SIGNAL'), true);
      assert.ok((EVALUATED_RULE_TYPES as readonly string[]).includes('CROWDING_SIGNAL'));
      assert.strictEqual(UNIMPLEMENTED_RULE_TYPES.CROWDING_SIGNAL, undefined);
    });
  });

  it('可订阅的类型集合与求值能力一致', () => {
    for (const ruleType of EVALUATED_RULE_TYPES) {
      assert.strictEqual(isEvaluatedRuleType(ruleType), true);
      // 每一个可订阅的类型，在**给足事实**的前提下都必须给出 true/false 而不是 null。
      assert.notStrictEqual(
        evaluateAlertTrigger(ruleType, entrantFacts),
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
