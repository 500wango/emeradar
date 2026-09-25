'use client';

import React from 'react';
import Link from 'next/link';
import {
  Clock,
  Bot,
  CreditCard,
  ShoppingBag,
  ArrowRight,
  Sparkles,
  MessageSquareQuote,
  Building2,
  ShieldCheck,
  Zap,
  TrendingUp,
} from 'lucide-react';

const SKILL_TIME_TRACKS = [
  {
    id: 'weekend',
    icon: Clock,
    title: '⏱️ 我只有周末 2 天时间',
    subtitle: '超轻量级 MVP (Class S)',
    badge: '零运维 · 纯前端 · 极速上线',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    description:
      '适合单兵作战。不需要数据库与复杂后端鉴权，只做单功能 Web 工具，依靠纯前端 WASM 或浏览器 API，快速收割自然搜索流量。',
    revenuePotential: '潜在收益：$300 ~ $800/mo (赞助 / 一次性购买 / 导流)',
    samples: [
      {
        slug: 'figma-design-tokens-to-tailwind-config',
        label: 'Figma Tokens 转 Tailwind 配置',
        dScore: 82,
        verdict: 'BUILD NOW',
      },
      {
        slug: 'free-screen-recorder-no-watermark-online',
        label: '浏览器纯本地无水印录屏',
        dScore: 94,
        verdict: 'BUILD NOW',
      },
      {
        slug: 'split-1gb-csv-file-online-without-crash',
        label: '超大 1GB CSV 本地防崩切分',
        dScore: 83,
        verdict: 'BUILD NOW',
      },
    ],
  },
  {
    id: 'ai-wrapper',
    icon: Bot,
    title: '🤖 我想做 AI 垂直包装工具',
    subtitle: 'LLM 刚需与本地轻量化',
    badge: '热搜风口 · 降本刚需 · 高转化',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
    description:
      '不卷大模型底座，专门解决大模型使用过程中的“周边工具链与成本焦虑”，或者用端侧模型解决传统云端太贵的痛点。',
    revenuePotential: '潜在收益：$800 ~ $3,000/mo (订阅制或 API 代币包)',
    samples: [
      {
        slug: 'deepseek-api-cost-calculator',
        label: 'DeepSeek R1/V3 Token 计费计算器',
        dScore: 92,
        verdict: 'BUILD NOW',
      },
      {
        slug: 'ai-vocal-isolator-browser',
        label: 'WebGPU 浏览器本地人声伴奏分离',
        dScore: 88,
        verdict: 'BUILD NOW',
      },
      {
        slug: 'local-whisper-subtitles-translator',
        label: '本地离线 Whisper 双语字幕烧录',
        dScore: 83,
        verdict: 'BUILD NOW',
      },
    ],
  },
  {
    id: 'micro-saas',
    icon: CreditCard,
    title: '💳 我想做每月收月费的 Micro-SaaS',
    subtitle: '持续自动化服务 (Class M)',
    badge: '月度 MRR · 刚需备份 · 高粘性',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    description:
      '适合有全栈经验的开发者。包含定时 Cron 任务、云端多租户或自动化异地存储，帮助小微企业守护关键资产，客户极难流失。',
    revenuePotential: '潜在收益：$1,500 ~ $6,000/mo (MRR 持续性收入)',
    samples: [
      {
        slug: 'supabase-automated-s3-backup-cron',
        label: 'Supabase 自动加密备份到 S3/R2',
        dScore: 84,
        verdict: 'BUILD NOW',
      },
      {
        slug: 'notion-database-backup-to-google-drive',
        label: 'Notion 自动备份到 Google Drive',
        dScore: 86,
        verdict: 'BUILD NOW',
      },
      {
        slug: 'dynamic-og-image-generator-nextjs',
        label: 'Next.js 15 动态社交分享图 API',
        dScore: 81,
        verdict: 'BUILD NOW',
      },
    ],
  },
  {
    id: 'ecommerce',
    icon: ShoppingBag,
    title: '🛍️ 我想做离钱最近的电商出海工具',
    subtitle: '卖家算账与利润神器',
    badge: '强付费意愿 · 算费刚需 · 痛点明确',
    badgeColor: 'bg-amber-50 text-amber-800 border-amber-200',
    description:
      'Shopify / Etsy / 独立站卖家每天都在算账。只要帮卖家算清净利润、避免多扣手续费或优化广告 ROI，卖家极度愿意掏钱。',
    revenuePotential: '潜在收益：$1,000 ~ $4,000/mo (Shopify App 或 Web 会员)',
    samples: [
      {
        slug: 'etsy-seller-profit-calculator-2026',
        label: 'Etsy 2026 最新手续费利润计算器',
        dScore: 88,
        verdict: 'BUILD NOW',
      },
      {
        slug: 'shopify-tiered-bundle-pricing-calculator',
        label: 'Shopify 多件阶梯捆绑利润测算器',
        dScore: 79,
        verdict: 'BUILD NOW',
      },
      {
        slug: 'ios-app-store-keyword-density-counter',
        label: 'iOS App Store 100字符 ASO 关键词优化器',
        dScore: 72,
        verdict: 'EARLY BET',
      },
    ],
  },
];

const PROVEN_FORMULAS = [
  {
    id: 'formula-reddit',
    icon: MessageSquareQuote,
    title: '公式 1：把 Reddit 吐槽帖做成现成工具',
    tagline: 'Reddit-to-Tool Arbitrage',
    color: 'border-orange-200 bg-gradient-to-b from-orange-50/50 to-white',
    textColor: 'text-orange-950',
    badge: '胜率极高 · 缺口明确',
    explanation:
      '当某个问题的搜索结果前 3 名全是被 Reddit 或 Quora 几年前的讨论帖占据时，意味着海量用户在搜，但市场上竟然没有现成好用的现代 Web 工具！你做一个干净的单页工具，极容易直接登顶 Google。',
    caseKeyword: 'free screen recorder no watermark online',
    caseSlug: 'free-screen-recorder-no-watermark-online',
    serpWeakness: '前 10 名中有 6 个是论坛抱怨帖与死链',
  },
  {
    id: 'formula-unbundle',
    icon: Building2,
    title: '公式 2：大厂昂贵功能单点拆解',
    tagline: 'Unbundle Big SaaS',
    color: 'border-blue-200 bg-gradient-to-b from-blue-50/50 to-white',
    textColor: 'text-blue-950',
    badge: '客单精准 · 降维打击',
    explanation:
      'TaxJar、Avalara、Sensor Tower 动辄收中小团队 $50 ~ $200/月，但 80% 的用户其实只需要里面最基础的一个“税率核算”或“ASO 查词”功能。你把这一项拆出来做成免费/极低门槛工具，就能轻松截获超高质量商业流量。',
    caseKeyword: 'shopify tiered bundle pricing calculator',
    caseSlug: 'shopify-tiered-bundle-pricing-calculator',
    serpWeakness: '竞品起步价 $49/mo，存在巨大免费轻量版空白',
  },
  {
    id: 'formula-privacy',
    icon: ShieldCheck,
    title: '公式 3：纯本地 WASM 零服务器隐私工具',
    tagline: 'Zero-Server Privacy First',
    color: 'border-emerald-200 bg-gradient-to-b from-emerald-50/50 to-white',
    textColor: 'text-emerald-950',
    badge: '零服务器成本 · 天然自传播',
    explanation:
      '大文件处理（如切分 1GB CSV、论文转 PDF）如果放在云端，不仅用户担心数据泄露，开发者每个月也会收到高额云服务器账单。利用浏览器本地 WASM / Web Worker 处理，既打中“隐私安全”，又省去全部算力成本。',
    caseKeyword: 'ai vocal isolator web free',
    caseSlug: 'ai-vocal-isolator-browser',
    serpWeakness: '竞品强制注册且上传音频有严格大小限制',
  },
  {
    id: 'formula-arbitrage',
    icon: Zap,
    title: '公式 4：平台与模型改版阵痛红利',
    tagline: 'Platform Update Arbitrage',
    color: 'border-indigo-200 bg-gradient-to-b from-indigo-50/50 to-white',
    textColor: 'text-indigo-950',
    badge: '爆发力强 · 3~6个月独占期',
    explanation:
      '每次大版本发布（如 DeepSeek 价格地震、Tailwind 4 发布、Etsy 调整 2026 手续费），都会在几周内制造巨大搜索激增。旧教程全失效，新官方文档又晦涩，谁能第一时间上线对应的计算器或适配器，谁就能吃满红利。',
    caseKeyword: 'deepseek api pricing and cost calculator',
    caseSlug: 'deepseek-api-cost-calculator',
    serpWeakness: '搜索爆发增长 210%，权威老站尚未跟进适配',
  },
];

export function IdeationHub() {
  return (
    <div className="space-y-12 my-12">
      {/* 模块 1：按技能与时间对号入座 */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                Builder Ideation Matrix
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 mt-1">
              不知道做什么？从你的「技术特长与时间」对号入座
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              不用拍脑袋硬想。无论你只有周末 2 天还是想做长线 SaaS，都能找到匹配的验证方向。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {SKILL_TIME_TRACKS.map((track) => {
            const Icon = track.icon;
            return (
              <div
                key={track.id}
                className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-900">{track.title}</h3>
                        <span className="text-xs text-slate-500 font-medium">{track.subtitle}</span>
                      </div>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${track.badgeColor}`}>
                      {track.badge}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed mb-4">
                    {track.description}
                  </p>

                  <div className="text-[11px] font-semibold text-slate-500 mb-2">
                    {track.revenuePotential}
                  </div>
                </div>

                {/* 推荐长尾词一键跳转 */}
                <div className="pt-4 border-t border-slate-100">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                    已验证的高潜力方向：
                  </span>
                  <div className="space-y-1.5">
                    {track.samples.map((s) => (
                      <Link
                        key={s.slug}
                        href={`/opportunities/${s.slug}`}
                        className="flex items-center justify-between p-2 rounded-xl bg-slate-50 hover:bg-blue-50/80 hover:text-blue-700 transition group text-xs font-semibold text-slate-700 border border-slate-100"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span className="truncate">{s.label}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] font-mono text-blue-600 font-bold">
                            D: {s.dScore}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 模块 2：4 大高胜率立项公式深度拆解 */}
      <div>
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
              The 4 Proven Winning Formulas
            </span>
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 mt-1">
            出海独立开发者「4 大高胜率立项公式」
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            为什么这些词最容易做出爆款？看懂背后的商业逻辑，立项成功率提升 5 倍以上。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {PROVEN_FORMULAS.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.id}
                className={`rounded-2xl border p-6 shadow-sm flex flex-col justify-between ${f.color}`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-white/80 border border-slate-200 flex items-center justify-center text-slate-700 shadow-2xs">
                        <Icon className="w-4 h-4" />
                      </div>
                      <h3 className={`text-base font-bold ${f.textColor}`}>{f.title}</h3>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white text-slate-700 border border-slate-200 shrink-0">
                      {f.badge}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed my-3">
                    {f.explanation}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-700">弱点特征：</span>
                    {f.serpWeakness}
                  </div>
                  <Link
                    href={`/opportunities/${f.caseSlug}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 shrink-0 group"
                  >
                    <span>查看真实用例</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
