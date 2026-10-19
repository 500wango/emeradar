/**
 * SERP 页面分类器（确定性，唯一事实来源）。
 *
 * 为什么要有这个文件：分类结果直接进 W 轴、进裁决。所以它必须
 *   - **可复现**：同一个 URL 永远同一个结论；
 *   - **可审计**：结论来自可读的注册表，不是模型黑箱；
 *   - **不默认乐观**：未知就是 `UNCLASSIFIED`，不再默认 `SPECIALIST`。
 *
 * 旧实现是 `text.includes('login') → OFFICIAL`、`text.includes('forum') → UGC`，
 * 其余一律 `SPECIALIST`。后果是把 wix.com 判成「正面竞争」、把 LinkedIn 判成
 * 「专属竞品」，弱点被系统性低估——方向刚好反了。
 *
 * 规则改动必须同时升 `PAGE_CLASSIFIER_VERSION`：历史快照按版本可分组，
 * 阈值与回测才知道自己在比哪一版。
 */
import type { ResultType } from './types';

export const PAGE_CLASSIFIER_VERSION = 'page-classifier-v2';

export type PageKind =
  /** 为这个需求专门做的产品/工具页：最值得警惕的竞争形态。 */
  | 'DEDICATED_TOOL'
  /** 泛平台落地页（建站、表单、托管商首页）——占位但不为这个需求服务。 */
  | 'GENERIC_PLATFORM'
  /** 托管/基础设施服务商（播客托管、SaaS 托管）——同上，不是同类竞品。 */
  | 'HOSTING_SERVICE'
  /** 目录/评测聚合站（G2、Capterra、AlternativeTo）。 */
  | 'DIRECTORY'
  /** 社区与 UGC（Reddit、Quora、LinkedIn 帖子、Medium）。 */
  | 'UGC'
  /** 官方文档、wiki、API 参考。 */
  | 'DOC'
  /** 编辑内容：博客、指南、listicle。 */
  | 'CONTENT'
  /** 视频。 */
  | 'VIDEO'
  /** 品牌官网首页（大厂域名根路径）。 */
  | 'OFFICIAL_BRAND'
  /** 没有足够证据判断——明确“不知道”。 */
  | 'UNCLASSIFIED';

/**
 * 域名注册表。**这里存的是世界知识**（wix 是建站平台、rss.com 是播客托管），
 * 适合当数据维护，而不是每次请求让模型重新猜。
 *
 * 匹配规则：完全相等，或作为子域后缀（`.wix.com`）。
 */
const DOMAIN_KINDS: ReadonlyArray<[string, PageKind]> = [
  // 社区 / UGC
  ['reddit.com', 'UGC'],
  ['quora.com', 'UGC'],
  ['linkedin.com', 'UGC'],
  ['medium.com', 'UGC'],
  ['substack.com', 'UGC'],
  ['facebook.com', 'UGC'],
  ['x.com', 'UGC'],
  ['twitter.com', 'UGC'],
  ['pinterest.com', 'UGC'],
  ['tiktok.com', 'UGC'],
  ['news.ycombinator.com', 'UGC'],
  ['discourse.org', 'UGC'],
  ['stackoverflow.com', 'UGC'],
  ['stackexchange.com', 'UGC'],
  ['producthunt.com', 'UGC'],

  // 文档 / 百科
  ['wikipedia.org', 'DOC'],
  ['developer.mozilla.org', 'DOC'],
  ['readthedocs.io', 'DOC'],
  ['docs.google.com', 'DOC'],

  // 目录 / 评测聚合
  ['g2.com', 'DIRECTORY'],
  ['capterra.com', 'DIRECTORY'],
  ['getapp.com', 'DIRECTORY'],
  ['softwareadvice.com', 'DIRECTORY'],
  ['alternativeto.net', 'DIRECTORY'],
  ['trustpilot.com', 'DIRECTORY'],
  ['software.com', 'DIRECTORY'],
  ['saasworthy.com', 'DIRECTORY'],

  // 泛平台（占位但不是同类竞品）
  ['wix.com', 'GENERIC_PLATFORM'],
  ['squarespace.com', 'GENERIC_PLATFORM'],
  ['wordpress.com', 'GENERIC_PLATFORM'],
  ['godaddy.com', 'GENERIC_PLATFORM'],
  ['shopify.com', 'GENERIC_PLATFORM'],
  ['webflow.com', 'GENERIC_PLATFORM'],
  ['notion.so', 'GENERIC_PLATFORM'],
  ['notion.site', 'GENERIC_PLATFORM'],
  ['canva.com', 'GENERIC_PLATFORM'],
  ['zapier.com', 'GENERIC_PLATFORM'],
  ['airtable.com', 'GENERIC_PLATFORM'],
  ['typeform.com', 'GENERIC_PLATFORM'],
  ['google.com', 'GENERIC_PLATFORM'],

  // 托管 / 基础设施
  ['rss.com', 'HOSTING_SERVICE'],
  ['transistor.fm', 'HOSTING_SERVICE'],
  ['castos.com', 'HOSTING_SERVICE'],
  ['buzzsprout.com', 'HOSTING_SERVICE'],
  ['podbean.com', 'HOSTING_SERVICE'],
  ['libsyn.com', 'HOSTING_SERVICE'],
  ['anchor.fm', 'HOSTING_SERVICE'],
  ['vercel.com', 'HOSTING_SERVICE'],
  ['netlify.com', 'HOSTING_SERVICE'],
  ['heroku.com', 'HOSTING_SERVICE'],
  ['railway.app', 'HOSTING_SERVICE'],
  ['render.com', 'HOSTING_SERVICE'],
  ['supabase.com', 'HOSTING_SERVICE'],
  ['cloudflare.com', 'HOSTING_SERVICE'],
  ['aws.amazon.com', 'HOSTING_SERVICE'],

  // 视频
  ['youtube.com', 'VIDEO'],
  ['vimeo.com', 'VIDEO'],
  ['loom.com', 'VIDEO'],

  // 大厂官网
  ['microsoft.com', 'OFFICIAL_BRAND'],
  ['apple.com', 'OFFICIAL_BRAND'],
  ['google.dev', 'OFFICIAL_BRAND'],
  ['adobe.com', 'OFFICIAL_BRAND'],
];

/** 内容站的路径特征：出现即视为编辑内容，而不是产品页。 */
const CONTENT_PATH = /\/(blog|guide|guides|how-to|howto|learn|resources|articles?|news|stories|insights|academy|tutorials?)(\/|$)/i;

/** 产品页的正面证据：没有它就不能叫 DEDICATED_TOOL。 */
const PRODUCT_PATH = /\/(pricing|plans|features?|tool|tools|app|product|products|convert|converter|generator|editor|dashboard|workspace|signup|start)(\/|$)/i;
const PRODUCT_TITLE = /\b(tool|app|software|generator|converter|editor|platform|saas|api|dashboard|workspace|studio)\b/i;

/** 文档路径。 */
const DOC_PATH = /\/(docs?|documentation|reference|api|wiki|manual)(\/|$)/i;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function isHomepagePath(path: string): boolean {
  return path === '' || path === '/';
}

/** 域名 → 注册表命中；子域也算（docs.stripe.com 命中 stripe.com 的规则则需显式声明）。 */
export function kindFromDomain(domain: string): PageKind | null {
  const host = domain.toLowerCase().replace(/^www\./, '');
  for (const [pattern, kind] of DOMAIN_KINDS) {
    if (host === pattern || host.endsWith(`.${pattern}`)) return kind;
  }
  return null;
}

export interface PageClassification {
  kind: PageKind;
  resultType: ResultType;
  /** 该页是否“为这个需求做的产品页”。只有它算正面竞争。 */
  isDedicatedTool: boolean;
  classifierVersion: string;
}

/** PageKind → 计分用的 ResultType。 */
const KIND_TO_RESULT_TYPE: Record<PageKind, ResultType> = {
  DEDICATED_TOOL: 'SPECIALIST',
  GENERIC_PLATFORM: 'GENERIC_PLATFORM',
  HOSTING_SERVICE: 'HOSTING_SERVICE',
  DIRECTORY: 'DIRECTORY',
  UGC: 'UGC_THREAD',
  DOC: 'DOC',
  CONTENT: 'EDITORIAL_MEDIA',
  VIDEO: 'VIDEO',
  OFFICIAL_BRAND: 'OFFICIAL',
  UNCLASSIFIED: 'UNCLASSIFIED',
};

/**
 * 分类单个结果。
 *
 * 顺序固定：注册表（世界知识）→ 路径/标题证据（产品页 vs 内容页）→ 未知。
 * 注册表优先，因为“wix 是建站平台”比“这个 URL 里有 /pricing”更根本。
 */
export function classifyPage(url: string, title = '', snippet = ''): PageClassification {
  const host = hostnameOf(url);
  const path = pathOf(url);
  const text = `${title} ${snippet}`;

  const fromRegistry = host ? kindFromDomain(host) : null;
  let kind: PageKind;

  if (fromRegistry) {
    // 注册表命中大厂官网时，如果落地页是产品页，仍按产品页算——
    // 否则「某大厂自带的工具页」会被当成无关品牌页而低估竞争。
    if (fromRegistry === 'OFFICIAL_BRAND' && PRODUCT_PATH.test(path)) {
      kind = 'DEDICATED_TOOL';
    } else {
      kind = fromRegistry;
    }
  } else if (DOC_PATH.test(path)) {
    kind = 'DOC';
  } else if (CONTENT_PATH.test(path)) {
    kind = 'CONTENT';
  } else if (PRODUCT_PATH.test(path) || (PRODUCT_TITLE.test(text) && !isHomepagePath(path))) {
    // 只有正面证据才判产品页；首页 + 泛标题不足以说明它是这个需求的竞品。
    kind = 'DEDICATED_TOOL';
  } else if (isHomepagePath(path)) {
    // 未知域名的首页：可能是工具站，也可能是无关站点。证据不足，不猜。
    kind = 'UNCLASSIFIED';
  } else {
    kind = 'UNCLASSIFIED';
  }

  return {
    kind,
    resultType: KIND_TO_RESULT_TYPE[kind],
    isDedicatedTool: kind === 'DEDICATED_TOOL',
    classifierVersion: PAGE_CLASSIFIER_VERSION,
  };
}

/** 域名权威度分类，与页面分类共用同一份注册表，避免两处各判各的。 */
export function classifyAuthority(url: string, domain: string): string {
  const kind = kindFromDomain(domain) ?? (hostnameOf(url) ? kindFromDomain(hostnameOf(url)) : null);
  switch (kind) {
    case 'UGC':
      return 'COMMUNITY_FORUM';
    case 'DIRECTORY':
      return 'AGGREGATOR';
    case 'DOC':
    case 'OFFICIAL_BRAND':
      return 'HIGH_AUTHORITY_GENERIC';
    case 'GENERIC_PLATFORM':
    case 'HOSTING_SERVICE':
      return 'GENERIC_PLATFORM';
    case 'DEDICATED_TOOL':
      return 'SPECIALIST';
    default:
      return 'UNCLASSIFIED';
  }
}
