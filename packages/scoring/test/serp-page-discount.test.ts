import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateSerpWeakness } from '../src';

/**
 * 审计问题 05（P1）：pageDiscount 被计算并写进每条结果，甚至写进了
 * 「权重享受 45% 折算」的结论文案里，但加总公式没有用它——解释与数字脱节。
 *
 * 修复后的语义：折算的是该结果对「窗口开放度」的贡献。
 *   - 首页是正面防御，全额计入（1.0）；
 *   - 专属工具落地页是有意防御，65%；
 *   - 大站无意内页只是占位，45%。
 * 逐条的 totalWeakness 保持未折算值（它回答「这个位置本身有多弱」），
 * 折算只发生在加总，discountedWeakness 让两条口径都可见。
 */
describe('SERP 弱度加总的页面折算（审计 05）', () => {
  const item = (url: string, extra: Record<string, unknown> = {}) => ({
    rank: 1,
    url,
    domain: 'example.com',
    title: 'Some page',
    resultType: 'UGC_THREAD' as const, // base 0.6
    ...extra,
  });

  it('首页全额、专属落地页 65%、普通内页 45% 计入总分', () => {
    const home = calculateSerpWeakness([item('https://example.com/')]);
    const landing = calculateSerpWeakness([
      item('https://example.com/pdf-merger', { isDedicatedLandingPage: true }),
    ]);
    const inner = calculateSerpWeakness([item('https://example.com/blog/random-post')]);

    assert.strictEqual(home.items[0].pageDiscount, 1.0);
    assert.strictEqual(landing.items[0].pageDiscount, 0.65);
    assert.strictEqual(inner.items[0].pageDiscount, 0.45);

    // rank 1 权重 0.20，唯一结果 → 归一化后总分 = 弱度 × 折算系数 × 100
    assert.strictEqual(home.score, 60); // 0.6 × 1.00
    assert.strictEqual(landing.score, 39); // 0.6 × 0.65
    assert.strictEqual(inner.score, 27); // 0.6 × 0.45
  });

  it('逐条 totalWeakness 保持未折算，折算值单独可见', () => {
    const res = calculateSerpWeakness([item('https://example.com/blog/random-post')]);
    assert.strictEqual(res.items[0].totalWeakness, 0.6);
    assert.strictEqual(res.items[0].discountedWeakness, 0.27);
    assert.strictEqual(res.items[0].isWeak, true, 'isWeak 按「位置本身弱不弱」判，不因折算翻转');
  });

  it('同强度的占位，首页版比内页版更值得穿透；文案宣称 45% 折算时公式必须真的用了它', () => {
    const home = calculateSerpWeakness([item('https://weak.example/')]);
    const inner = calculateSerpWeakness([item('https://big-site.example/blog/old-post')]);
    assert.ok(home.score > inner.score);

    const allInner = calculateSerpWeakness([
      item('https://a.example/blog/1', { rank: 1 }),
      item('https://b.example/blog/2', { rank: 2 }),
      item('https://c.example/x/3', { rank: 3 }),
      item('https://d.example/y/4', { rank: 4 }),
      item('https://e.example/z/5', { rank: 5 }),
    ]);
    assert.ok(
      allInner.structuralPenetrationReasons.some((r) => r.includes('45% 折算')),
      'innerPagesCount ≥ 5 的结论仍应说明折算口径'
    );
  });
});
