import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canCompare, canOpenFullOpportunity, canOpenReport } from '../src/lib/plan-access';

/**
 * 套餐门禁的纯函数。
 *
 * 这三条判断以前散落在 compare / detail / report 三处：compare 没有门禁，
 * report API 漏了 Free 限制，详情页与报告页各写一套。抽出来之后，至少"Free 能看
 * 什么"只有一份答案，路由与页面都从它派生。
 */
const FREE = { opportunityDetailFull: false };
const PAID = { opportunityDetailFull: true };

describe('套餐访问判据', () => {
  it('比较：只有付费层可以并排比较活跃机会', () => {
    assert.strictEqual(canCompare(FREE), false);
    assert.strictEqual(canCompare(PAID), true);
  });

  it('详情：Free 只放行本周精选；付费层全部放行', () => {
    assert.strictEqual(canOpenFullOpportunity(FREE, null), false, 'Free 没有周案例时不该放行');
    assert.strictEqual(canOpenFullOpportunity(FREE, 'opp_weekly'), true);
    assert.strictEqual(canOpenFullOpportunity(PAID, null), true);
  });

  it('报告：付费层只对 BUILD_NOW/EARLY_BET；Free 只对周案例（历史预览）', () => {
    assert.strictEqual(canOpenReport(PAID, null, 'BUILD_NOW'), true);
    assert.strictEqual(canOpenReport(PAID, null, 'EARLY_BET'), true);
    assert.strictEqual(canOpenReport(PAID, null, 'WATCH'), false, '付费层也不该给历史案例生成报告');
    assert.strictEqual(canOpenReport(FREE, 'opp_weekly', 'PASS'), true, 'Free 的周案例必须有预览入口');
    assert.strictEqual(canOpenReport(FREE, null, 'PASS'), false, '没有周案例的 Free 不能生成报告');
  });
});
