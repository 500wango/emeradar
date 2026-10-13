import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PublicPublicationService } from '../src';

/**
 * 公开页质量门的门线本身。
 *
 * 这些断言看起来琐碎，钉的却是这一轮修掉的那个问题：门线曾是 **40 词**，而
 * docs/15 §5 要求英文 600 词 / 中文 800 字。40 是照着"当前卡片字段有多长"填的，
 * 于是门永远通过、页面永远 `indexable = true`，而质检报告对外表现为查过六项。
 * 门线一旦可以随便调，它就不是门。
 */
describe('公开页质量门的字数口径（docs/15 §5）', () => {
  it('门线就是规格值，不是当前数据能过的值', () => {
    assert.strictEqual(PublicPublicationService.MIN_BODY_WORDS_EN, 600);
    assert.strictEqual(PublicPublicationService.MIN_BODY_WORDS_ZH, 800);
  });

  it('英文按词计，中文按有效字符计', () => {
    assert.strictEqual(PublicPublicationService.countBodyUnits('', 'en-US'), 0);
    assert.strictEqual(PublicPublicationService.countBodyUnits('   \n  ', 'en-US'), 0);
    assert.strictEqual(PublicPublicationService.countBodyUnits('stripe dispute evidence', 'en-US'), 3);
    // 连续空白不产生空词。
    assert.strictEqual(PublicPublicationService.countBodyUnits('  a   b  ', 'en-US'), 2);

    assert.strictEqual(PublicPublicationService.countBodyUnits('这是一个测试', 'zh-CN'), 6);
    // 空白与标点不承载信息，不计入"有效字数"。
    assert.strictEqual(PublicPublicationService.countBodyUnits('这是一个测试。', 'zh-CN'), 6);
    assert.strictEqual(PublicPublicationService.countBodyUnits('这 是 一 个 测试', 'zh-CN'), 6);
    assert.strictEqual(PublicPublicationService.countBodyUnits('这是一个测试', 'zh-TW'), 6);
  });

  it('同一段拉丁文本在中文 locale 下不会被按词计成很小的数', () => {
    // 规格的 800"字"是给中文正文定的。若把一段英文按字符数计，会得出一个大得
    // 多、却毫无意义的数；反过来把中文按空格分词只得到 1 —— 两种错法都能让门线
    // 失真，所以口径必须由 locale 决定。
    const zh = PublicPublicationService.countBodyUnits('这是一个很长的中文句子用来测试', 'zh-CN');
    const en = PublicPublicationService.countBodyUnits('这是一个很长的中文句子用来测试', 'en-US');
    assert.ok(zh > en, '中文正文在中文 locale 下应当按字计得更多');
    assert.strictEqual(en, 1);
  });
});
