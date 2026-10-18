/**
 * 公开投影要产出的 locale 集合（03 §17 I14）。
 *
 * 原先住在 `stealth-lock-policy.ts` 里，与打码显示行同源。v3.1 删掉了买断与打码，
 * 但**发布层仍然只会产出这些语言的页面**，live-scan 也要按同一个语言找已发布投影。
 * 所以它搬到这里，而不是跟着买断一起消失。
 */
export const PUBLICATION_LOCALES = ['en-US'] as const;
