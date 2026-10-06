import {
  Verdict,
  Lifecycle,
  BuildArchetype,
  ExecutionClass,
  Locale,
} from '@emeradar/core';
import { IndieCompetitionAudit } from './types';

export interface OpportunityZhInfo {
  title: string;
  whyNow: string;
  topIdea: string;
  recommendedProductShape: string;
  weaknessReasons?: Record<string, string>;
  indieCompetitionAudit?: IndieCompetitionAudit;
}

export const KNOWN_OPPORTUNITIES_ZH: Record<string, OpportunityZhInfo> = {
  opp_stripe_dispute_compiler: {
    title: 'Stripe 争议退款证据自动收集与抗辩举证中心',
    whyNow:
      '2026 年 Stripe 每笔争议退款手续费上涨至 15 美元。Google 搜索前 10 名被官方通用文档页和 Reddit 论坛帖占据，严重缺乏自助式争议申诉证据 PDF 打包工具。',
    topIdea:
      '轻量 Webhook 自动化接收器：自动聚合用户登录时间戳、物流追踪和结账用户协议，一键导出符合 Stripe 官方抗辩格式的申诉举证包。',
    recommendedProductShape: '微型 SaaS（Webhook 集成与抗辩举证中心）',
    weaknessReasons: {
      'stripe.com': '官方通用文档页，缺乏可直接下载的自动化举证打包工具',
      'reddit.com': '社区论坛讨论帖，缺乏结构化工具与标准模板',
      'chargeflow.io': '高门槛企业级方案（月费 $500 起），对小微出海商家极不友好',
      'medium.com': '2023 年陈旧博客文章，内容已过时',
      'chargeblast.com': '传统争议拦截平台',
    },
  },
  'stripe-dispute-evidence-compiler': {
    title: 'Stripe 争议退款证据自动收集与抗辩举证中心',
    whyNow:
      '2026 年 Stripe 每笔争议退款手续费上涨至 15 美元。Google 搜索前 10 名被官方通用文档页和 Reddit 论坛帖占据，严重缺乏自助式争议申诉证据 PDF 打包工具。',
    topIdea:
      '轻量 Webhook 自动化接收器：自动聚合用户登录时间戳、物流追踪和结账用户协议，一键导出符合 Stripe 官方抗辩格式的申诉举证包。',
    recommendedProductShape: '微型 SaaS（Webhook 集成与抗辩举证中心）',
  },
  opp_podcast_transcript_seo: {
    title: '播客音频转文字稿与 SEO 文章生成器',
    whyNow:
      'Apple Podcasts 现已全量自动生成音频文字稿，释放了海量音频文本红利。独立创作者急需低门槛转为 SEO 博客文章的工具，无需为动辄 $99/月的大型企业套件买单。',
    topIdea:
      '粘贴音频 VTT/SRT 字幕或播客 RSS 链接，自动提取时间戳与高权重 FAQ 结构化数据，一键导出可直接被 Google 收录的 Markdown 博客长文。',
    recommendedProductShape: '免登录单页轻量工具（音频转文章生成器）',
    weaknessReasons: {
      'transistor.fm': '纯理论教学指南，未提供实际处理工具',
      'descript.com': '需要安装笨重桌面客户端，门槛过高且必须注册安装',
      'podcastle.ai': '浅层营销软文，无实质工具功能',
      'castos.com': '播客托管平台内页，非专属独立转换工具',
    },
  },
  'podcast-transcript-seo-generator': {
    title: '播客音频转文字稿与 SEO 文章生成器',
    whyNow:
      'Apple Podcasts 现已全量自动生成音频文字稿，释放了海量音频文本红利。独立创作者急需低门槛转为 SEO 博客文章的工具，无需为动辄 $99/月的大型企业套件买单。',
    topIdea:
      '粘贴音频 VTT/SRT 字幕或播客 RSS 链接，自动提取时间戳与高权重 FAQ 结构化数据，一键导出可直接被 Google 收录的 Markdown 博客长文。',
    recommendedProductShape: '免登录单页轻量工具（音频转文章生成器）',
  },
  opp_cron_deadman_monitor: {
    title: '定时任务心跳检测与失联 Webhook 告警监控器',
    whyNow:
      '在 Render、Railway、Supabase 上部署的独立开发者普遍缺乏极简的心跳监测手段；传统企业级方案（如 PagerDuty、BetterStack）功能臃肿且按人头收费昂贵。',
    topIdea:
      '零配置心跳监控接口：任务执行完毕后只需 curl 发送请求打卡；一旦定时任务失联未打卡，立即通过 Telegram、Discord 和邮件触发 Webhook 告警。',
    recommendedProductShape: '极简轻量工具（定时任务心跳告警监控器）',
    weaknessReasons: {
      'deadmanssnitch.com': '2018 年陈旧界面，免费套餐限制严苛',
      'stackoverflow.com': '问答社区零散讨论，无开箱即用服务',
      'betterstack.com': '大站通用教程内页，缺乏一键接入工具',
    },
  },
  'cron-job-deadman-webhook-monitor': {
    title: '定时任务心跳检测与失联 Webhook 告警监控器',
    whyNow:
      '在 Render、Railway、Supabase 上部署的独立开发者普遍缺乏极简的心跳监测手段；传统企业级方案（如 PagerDuty、BetterStack）功能臃肿且按人头收费昂贵。',
    topIdea:
      '零配置心跳监控接口：任务执行完毕后只需 curl 发送请求打卡；一旦定时任务失联未打卡，立即通过 Telegram、Discord 和邮件触发 Webhook 告警。',
    recommendedProductShape: '极简轻量工具（定时任务心跳告警监控器）',
  },
  opp_nextjs_boilerplate_matrix: {
    title: 'Next.js & Supabase SaaS 模板矩阵与交互式选型对比器',
    whyNow:
      '2025-2026 年市面涌现超过 50 款付费 Next.js 模板/脚手架，开发者需耗费数小时比对功能。目前全网缺乏结构化对比导航，搜索结果充斥带偏见的分销返佣软文。',
    topIdea:
      '交互式特性对比矩阵：支持按身份认证（Supabase/Clerk）、支付通道（Stripe/LemonSqueezy）、UI 库（Tailwind/Shadcn）及开源协议进行多维度筛选与对比。',
    recommendedProductShape: '精选导航站（Next.js 脚手架交互式参数对比矩阵）',
    weaknessReasons: {
      'github.com': '未筛选的通用代码仓库列表，缺乏商业化特性对比',
      'reddit.com': '社区非结构化讨论帖，主观性强且内容分散',
      'dev.to': '个人开发者博客文章，覆盖模板数量非常有限',
    },
  },
  'nextjs-boilerplate-matrix': {
    title: 'Next.js & Supabase SaaS 模板矩阵与交互式选型对比器',
    whyNow:
      '2025-2026 年市面涌现超过 50 款付费 Next.js 模板/脚手架，开发者需耗费数小时比对功能。目前全网缺乏结构化对比导航，搜索结果充斥带偏见的分销返佣软文。',
    topIdea:
      '交互式特性对比矩阵：支持按身份认证（Supabase/Clerk）、支付通道（Stripe/LemonSqueezy）、UI 库（Tailwind/Shadcn）及开源协议进行多维度筛选与对比。',
    recommendedProductShape: '精选导航站（Next.js 脚手架交互式参数对比矩阵）',
  },
  opp_pdf_privacy_redact: {
    title: '纯本地端 WebAssembly PDF 隐私抹除与脱敏工具',
    whyNow:
      '隐私合规与保密协议（NDA）严禁开发者和承包商将机密文件上传至云端 PDF 转换网站（如 ILovePDF）。无需上传服务器、基于 WebAssembly 的纯本地工具需求激增。',
    topIdea:
      '100% 浏览器本地 WebAssembly 处理工具：在本地抹除水印和涂黑隐私脱敏信息，绝不向任何第三方服务器传输文档数据。',
    recommendedProductShape: '免登录本地轻量工具（纯浏览器端 WebAssembly PDF 隐私抹除器）',
    weaknessReasons: {
      'adobe.com': '强制上传文件至 Adobe 云端并强制要求注册登录',
      'ilovepdf.com': '服务器端上传处理，违反保密协议与数据隐私要求',
      'ycombinator.com': '社区零散讨论帖，非成熟易用产品',
    },
    indieCompetitionAudit: {
      barrierToEntry: 'LOW',
      barrierReason: '核心功能基于前端 WebAssembly 与成熟开源 PDF 库（如 pdf-lib），技术复制门槛极低（2~3 天即可成型），极易被中小开发者同质化批量克隆。',
      indieEntrantDensity: 'HIGH',
      densityWarning: '⚠️ 警惕水下内卷：中小团队虽未进入 Google 前三，但 Chrome 插件商店与 GitHub 已出现多个同类单功能原型，Rank 11~30 位也有新站排队。',
      shadowChannels: [
        {
          channel: 'CHROME_EXTENSION',
          presence: 'DETECTED',
          observation: 'Chrome 商店已有单功能本地脱敏扩展瓜分存量高频用户，部分免登录流量被截流。',
        },
        {
          channel: 'GITHUB_OPENSOURCE',
          presence: 'MODERATE',
          observation: '存在现成高星开源 Demo，任何中小开发者均可半天内套壳上线。',
        },
        {
          channel: 'SERP_PAGES_2_3',
          presence: 'DETECTED',
          observation: 'Rank 11~30 位已观测到 4 个低权重（DR<25）独立新站正在排队爬坡。',
        },
      ],
      defensiveMoatAdvice: '严禁做无壁垒的泛化单功能玩具；必须与高客单垂直场景（如“跨境电商海关合同脱敏”、“法务合同批量打码”、“AI 提示词敏感信息拦截”）深度绑定，建立定制化场景壁垒。',
    },
  },
  'pdf-privacy-redact-watermark-utility': {
    title: '纯本地端 WebAssembly PDF 隐私抹除与脱敏工具',
    whyNow:
      '隐私合规与保密协议（NDA）严禁开发者和承包商将机密文件上传至云端 PDF 转换网站（如 ILovePDF）。无需上传服务器、基于 WebAssembly 的纯本地工具需求激增。',
    topIdea:
      '100% 浏览器本地 WebAssembly 处理工具：在本地抹除水印和涂黑隐私脱敏信息，绝不向任何第三方服务器传输文档数据。',
    recommendedProductShape: '免登录本地轻量工具（纯浏览器端 WebAssembly PDF 隐私抹除器）',
    indieCompetitionAudit: {
      barrierToEntry: 'LOW',
      barrierReason: '核心功能基于前端 WebAssembly 与成熟开源 PDF 库（如 pdf-lib），技术复制门槛极低（2~3 天即可成型），极易被中小开发者同质化批量克隆。',
      indieEntrantDensity: 'HIGH',
      densityWarning: '⚠️ 警惕水下内卷：中小团队虽未进入 Google 前三，但 Chrome 插件商店与 GitHub 已出现多个同类单功能原型，Rank 11~30 位也有新站排队。',
      shadowChannels: [
        {
          channel: 'CHROME_EXTENSION',
          presence: 'DETECTED',
          observation: 'Chrome 商店已有单功能本地脱敏扩展瓜分存量高频用户，部分免登录流量被截流。',
        },
        {
          channel: 'GITHUB_OPENSOURCE',
          presence: 'MODERATE',
          observation: '存在现成高星开源 Demo，任何中小开发者均可半天内套壳上线。',
        },
        {
          channel: 'SERP_PAGES_2_3',
          presence: 'DETECTED',
          observation: 'Rank 11~30 位已观测到 4 个低权重（DR<25）独立新站正在排队爬坡。',
        },
      ],
      defensiveMoatAdvice: '严禁做无壁垒的泛化单功能玩具；必须与高客单垂直场景（如“跨境电商海关合同脱敏”、“法务合同批量打码”、“AI 提示词敏感信息拦截”）深度绑定，建立定制化场景壁垒。',
    },
  },
  opp_adsense_rpm_simulator: {
    title: 'AdSense 多单元 RPM 收益测算与广告排版预估器',
    whyNow:
      'Google 将 AdSense 全面转向基于展示次数计费（eCPM）。现有计算器仍停留在 2020 年陈旧的 CPC 点击模型，无法满足出海站长对不同国家地域 RPM 的精准收益测算。',
    topIdea:
      '交互式收益模拟器：基于访客地域等级（T1 欧美国家对比 T3 发展中国家）、页面浏览深度、广告排版密度及网页核心体验指标（CWV）精准推算月度收入。',
    recommendedProductShape: '出海站长交互式收益测算工具（AdSense 多地域 RPM 模拟器）',
    weaknessReasons: {
      'google.com': '官方过于简化的粗略估算小部件，缺乏细分赛道与地域分解',
      'monetizemore.com': '设置门槛强制收集邮箱销售线索',
      'shoutmeloud.com': '2021 年过时教程，计费逻辑已脱节',
    },
  },
  'adsense-rpm-revenue-simulator': {
    title: 'AdSense 多单元 RPM 收益测算与广告排版预估器',
    whyNow:
      'Google 将 AdSense 全面转向基于展示次数计费（eCPM）。现有计算器仍停留在 2020 年陈旧的 CPC 点击模型，无法满足出海站长对不同国家地域 RPM 的精准收益测算。',
    topIdea:
      '交互式收益模拟器：基于访客地域等级（T1 欧美国家对比 T3 发展中国家）、页面浏览深度、广告排版密度及网页核心体验指标（CWV）精准推算月度收入。',
    recommendedProductShape: '出海站长交互式收益测算工具（AdSense 多地域 RPM 模拟器）',
  },
};

export function getLocalizedOpportunityText(
  idOrSlug: string,
  field: 'title' | 'whyNow' | 'topIdea' | 'recommendedProductShape',
  fallback: string,
  locale: Locale = 'en-US'
): string {
  if (locale !== 'zh-CN') return fallback;
  const match = KNOWN_OPPORTUNITIES_ZH[idOrSlug];
  if (match && match[field]) {
    return match[field];
  }
  return fallback;
}

export function formatVerdict(
  verdict: Verdict,
  locale: Locale = 'en-US',
  detailed: boolean = false
): string {
  if (locale === 'zh-CN') {
    switch (verdict) {
      case 'BUILD_NOW':
        return detailed ? '🟢 立即立项 (BUILD NOW)' : '立即立项';
      case 'EARLY_BET':
        return detailed ? '🔵 早期下注 (EARLY BET)' : '早期下注';
      case 'WINDOW_CLOSING':
        return detailed ? '🟡 窗口收窄 (WINDOW CLOSING)' : '窗口收窄';
      case 'WATCH':
        return detailed ? '⚪ 持续观察 (WATCH)' : '持续观察';
      case 'PASS':
        return detailed ? '🔴 建议放弃 (PASS)' : '建议放弃';
      default:
        return verdict;
    }
  }
  return verdict.replace(/_/g, ' ');
}

export function formatVerdictDescription(
  verdict: Verdict,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (verdict) {
      case 'BUILD_NOW':
        return '搜索需求旺盛、付费验证充分且竞争进入窗口良好，建议立即立项开发。';
      case 'EARLY_BET':
        return '赛道处于早期形成红利期，建议以极简单页或轻量原型抢占早期搜索心智。';
      case 'WINDOW_CLOSING':
        return '行业大站或头部竞品正在巩固排位，进入阻力增大，需审慎评估。';
      case 'WATCH':
        return '数据信号尚未达到立项标准，建议放入雷达监控列表持续观察。';
      case 'PASS':
        return '商业变现或竞争窗口评估不理想，建议放弃该方向以节约开发精力。';
      default:
        return '';
    }
  }
  switch (verdict) {
    case 'BUILD_NOW':
      return 'High search demand, verified monetization, and low entry resistance.';
    case 'EARLY_BET':
      return 'Emerging search pattern; early prototype recommended to capture organic equity.';
    case 'WINDOW_CLOSING':
      return 'Incumbents consolidating SERP dominance; elevated entry friction.';
    case 'WATCH':
      return 'Signals below build threshold; monitor in radar watchlist.';
    case 'PASS':
      return 'Low upside or prohibitive incumbent resistance.';
    default:
      return '';
  }
}

export function formatLifecycle(
  lifecycle: Lifecycle,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (lifecycle) {
      case 'EARLY_WINDOW':
        return '早期红利窗口 (Early Window)';
      case 'FORMING':
        return '需求形成期 (Forming)';
      case 'CONTESTED':
        return '激烈争夺期 (Contested)';
      case 'MATURE':
        return '成熟饱和期 (Mature)';
      case 'DEAD':
        return '生命周期衰竭 (Dead)';
      default:
        return lifecycle;
    }
  }
  return lifecycle.replace(/_/g, ' ');
}

export function formatArchetype(
  archetype: BuildArchetype,
  locale: Locale = 'en-US',
  detailed: boolean = false
): string {
  if (locale === 'zh-CN') {
    switch (archetype) {
      case 'LIGHTWEIGHT_TOOL':
        return detailed
          ? '免登录单页轻量工具 (Lightweight Tool)'
          : '免登录单页轻量工具';
      case 'MICRO_SAAS':
        return detailed ? '轻量微型 SaaS (Micro-SaaS)' : '轻量微型 SaaS';
      case 'DIRECTORY':
        return detailed ? '细分精选导航站 (Directory)' : '细分精选导航站';
      case 'CONTENT_SITE':
        return detailed ? '垂直专业内容站 (Content Site)' : '垂直专业内容站';
      default:
        return archetype;
    }
  }
  switch (archetype) {
    case 'LIGHTWEIGHT_TOOL':
      return 'Lightweight Tool';
    case 'MICRO_SAAS':
      return 'Micro-SaaS';
    case 'DIRECTORY':
      return 'Curated Directory';
    case 'CONTENT_SITE':
      return 'Content Site';
    default:
      return archetype;
  }
}

export function formatExecutionClass(
  executionClass: ExecutionClass,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (executionClass) {
      case 'S':
        return 'S 级（极轻量：建议 14 天内冲刺上线 MVP）';
      case 'M':
        return 'M 级（中等量级：建议 30 天内上线 MVP）';
      case 'L':
        return 'L 级（重量级：适合全职或小团队长期攻坚）';
      default:
        return executionClass;
    }
  }
  switch (executionClass) {
    case 'S':
      return 'Class S (<14-day sprint)';
    case 'M':
      return 'Class M (<30-day build)';
    case 'L':
      return 'Class L (Team build)';
    default:
      return executionClass;
  }
}

export function formatPenetrationAngle(
  angle: string,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (angle) {
      case 'HOMEPAGE_DIRECT':
        return '单页专属首页正面穿透 (Homepage Direct)';
      case 'ALTERNATIVE_INTERCEPT':
        return '竞品替代品 / 选型评测截流 (Alternative Intercept)';
      case 'LONGTAIL_CLUSTER':
        return '长尾轻量工具矩阵协同 (Longtail Cluster)';
      case 'AGGREGATOR_PAGE':
        return '高权重长尾聚合页 (Aggregator Page)';
      default:
        return angle;
    }
  }
  return angle.replace(/_/g, ' ');
}

export function formatSearchIntent(
  intent: string,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (intent) {
      case 'TRANSACTIONAL':
        return '工具操作型 (寻找即用工具/下载)';
      case 'COMMERCIAL':
        return '商业调研型 (对比选型/准备付费)';
      case 'INFORMATIONAL':
        return '信息获取型 (了解概念/寻找教程)';
      case 'NAVIGATIONAL':
        return '品牌寻址型 (寻找特定官网)';
      default:
        return intent;
    }
  }
  return intent;
}

export function formatSiteStrategy(
  strategy: string,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (strategy) {
      case 'INDEPENDENT_SITE':
        return '独立专属域名站点 (推荐)';
      case 'EXISTING_SITE_PAGE':
        return '现有站点的二级目录或独立落地页';
      case 'WATCH':
        return '暂缓建站，加入雷达观察';
      default:
        return strategy;
    }
  }
  switch (strategy) {
    case 'INDEPENDENT_SITE':
      return 'Independent Dedicated Site';
    case 'EXISTING_SITE_PAGE':
      return 'Landing Page on Existing Domain';
    case 'WATCH':
      return 'Watchlist';
    default:
      return strategy;
  }
}

export function formatResultType(
  type: string,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (type) {
      case 'ORGANIC':
        return '普通网页';
      case 'OFFICIAL':
        return '官方垄断';
      case 'FORUM_UGC':
        return '社区论坛';
      case 'BLOG':
        return '博客文章';
      case 'AGGREGATOR':
        return '聚合导航';
      default:
        return type;
    }
  }
  return type;
}

export function formatVolumeTier(
  tier: string,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (tier) {
      case 'HIGH':
        return '高搜索量';
      case 'MEDIUM':
        return '中等搜索量';
      case 'EMERGING':
        return '新增长尾';
      default:
        return tier;
    }
  }
  return tier;
}

export function formatPricingModel(
  model: string,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (model) {
      case 'SUBSCRIPTION':
        return '订阅制 (月付/年付)';
      case 'ONE_TIME':
        return '一次性买断';
      case 'FREEMIUM':
        return '免费增值 (基础免费+高级付费)';
      case 'USAGE_BASED':
        return '按使用量计费';
      default:
        return model;
    }
  }
  return model;
}

export function translateWeaknessReason(
  domain: string,
  originalReason: string | undefined,
  opportunityIdOrSlug?: string,
  locale: Locale = 'en-US'
): string {
  if (locale !== 'zh-CN') return originalReason || 'N/A';
  if (!originalReason) return '缺乏专注此痛点的独立工具页';

  if (opportunityIdOrSlug) {
    const opp = KNOWN_OPPORTUNITIES_ZH[opportunityIdOrSlug];
    if (opp?.weaknessReasons && opp.weaknessReasons[domain]) {
      return opp.weaknessReasons[domain];
    }
  }

  // Common pattern translations
  const lower = originalReason.toLowerCase();
  if (lower.includes('generic documentation')) {
    return '官方通用文档页，缺乏一键式自动化工具';
  }
  if (lower.includes('forum ugc') || lower.includes('reddit')) {
    return '社区论坛讨论帖，内容分散且缺乏结构化工具';
  }
  if (lower.includes('enterprise') || lower.includes('contract wall')) {
    return '高门槛企业级收费套件，小微个人用户无法承受';
  }
  if (lower.includes('outdated')) {
    return '内容陈旧过时的早期文章，缺乏持续维护';
  }
  if (lower.includes('educational guide')) {
    return '纯理论教学指南，未提供实际处理工具';
  }
  if (lower.includes('heavyweight')) {
    return '需要安装笨重桌面客户端，使用门槛过高';
  }
  if (lower.includes('marketing blog') || lower.includes('shallow')) {
    return '浅层营销软文，无直接工具交付功能';
  }
  if (lower.includes('inner page')) {
    return '大站顺路覆盖的通用内页，缺乏专属首页聚焦体验';
  }
  if (lower.includes('dated ui')) {
    return '界面陈旧过时，免费额度限制苛刻';
  }
  if (lower.includes('unfiltered')) {
    return '未筛选的通用代码列表，缺乏直观特性对比';
  }
  if (lower.includes('upload') || lower.includes('cloud')) {
    return '强制上传云端并要求注册登录，存在隐私隐患';
  }

  return originalReason;
}

export function getLocalizedIndieAudit(
  idOrSlug: string,
  fallback: IndieCompetitionAudit,
  locale: Locale = 'en-US'
): IndieCompetitionAudit {
  if (locale !== 'zh-CN') return fallback;
  const match = KNOWN_OPPORTUNITIES_ZH[idOrSlug];
  if (match?.indieCompetitionAudit) {
    return match.indieCompetitionAudit;
  }
  return fallback;
}

export function formatBarrierToEntry(
  barrier: 'LOW' | 'MEDIUM' | 'HIGH',
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (barrier) {
      case 'LOW':
        return '⚠️ 低壁垒（极易被低成本复制套壳）';
      case 'MEDIUM':
        return '🟡 中等壁垒（需要垂直数据/工作流整合）';
      case 'HIGH':
        return '🛡️ 高壁垒（具备算法/数据专有护城河）';
      default:
        return barrier;
    }
  }
  switch (barrier) {
    case 'LOW':
      return 'Low Barrier (High Clonation & Saturation Risk)';
    case 'MEDIUM':
      return 'Moderate Barrier (Requires Workflow Integration)';
    case 'HIGH':
      return 'High Barrier (Proprietary Data / Deep Architecture)';
    default:
      return barrier;
  }
}

export function formatIndieEntrantDensity(
  density: 'LOW' | 'MODERATE' | 'HIGH',
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (density) {
      case 'LOW':
        return '🟢 稀疏（暂未发现中小开发者扎堆抢词）';
      case 'MODERATE':
        return '🟡 温和（少数独立站与开源项目正在进入）';
      case 'HIGH':
        return '🔴 密集（大量中小开发者正在排队涌入）';
      default:
        return density;
    }
  }
  switch (density) {
    case 'LOW':
      return 'Minimal Influx (Few Indie Entrants)';
    case 'MODERATE':
      return 'Moderate Influx (Emerging Clones)';
    case 'HIGH':
      return 'High Influx (Dense Indie Entrants In Queue)';
    default:
      return density;
  }
}

export function formatShadowChannel(
  channel: string,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (channel) {
      case 'CHROME_EXTENSION':
        return 'Chrome 插件商店 (Chrome Web Store)';
      case 'GITHUB_OPENSOURCE':
        return 'GitHub 开源项目与 Demo 库';
      case 'SERP_PAGES_2_3':
        return 'Google 搜索第 2~3 页 (Rank 11~30)';
      case 'COMMUNITY_MICROS':
        return 'Product Hunt / 独立开发者社区';
      default:
        return channel;
    }
  }
  switch (channel) {
    case 'CHROME_EXTENSION':
      return 'Chrome Web Store Extensions';
    case 'GITHUB_OPENSOURCE':
      return 'GitHub Open-Source Repos';
    case 'SERP_PAGES_2_3':
      return 'Google SERP Pages 2-3 (Rank 11-30)';
    case 'COMMUNITY_MICROS':
      return 'Product Hunt & Community Launches';
    default:
      return channel;
  }
}

export function formatPresence(
  presence: string,
  locale: Locale = 'en-US'
): string {
  if (locale === 'zh-CN') {
    switch (presence) {
      case 'DETECTED':
        return '🔴 已检测到竞品占位';
      case 'MODERATE':
        return '🟡 存在少数替代方案';
      case 'MINIMAL':
        return '🟢 几乎无竞争占位';
      default:
        return presence;
    }
  }
  switch (presence) {
    case 'DETECTED':
      return 'Detected';
    case 'MODERATE':
      return 'Moderate';
    case 'MINIMAL':
      return 'Minimal';
    default:
      return presence;
  }
}

