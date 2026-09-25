import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Check } from 'lucide-react';

export default function LogoPreviewPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 sm:p-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Emeradar</span>
            </Link>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              EmeRadar Logo 比例与美感优化对比
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              针对“图标偏大且原有手绘曲线略显粗糙失衡”的视觉问题，提供 4 种精修与设计演进方案
            </p>
          </div>
        </div>

        <div className="space-y-8">
          {/* Option 0: Current */}
          <div className="p-6 rounded-2xl bg-slate-800/80 border border-rose-500/30">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-400">
                当前版本（问题诊断：比例失衡 200px vs 90px，手绘曲线变形）
              </span>
              <span className="text-xs text-rose-400 font-mono">高度 200px (偏大 2.2倍)</span>
            </div>
            <div className="p-6 rounded-xl bg-slate-950 flex items-center justify-center border border-slate-800">
              <svg viewBox="0 0 1200 280" className="w-full max-w-2xl h-auto" fill="none">
                <defs>
                  <linearGradient id="g0_icon" x1="60" y1="230" x2="300" y2="70" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#7C3AED" />
                    <stop offset="35%" stopColor="#2563EB" />
                    <stop offset="68%" stopColor="#06B6D4" />
                    <stop offset="100%" stopColor="#34D399" />
                  </linearGradient>
                  <linearGradient id="g0_text" x1="350" y1="100" x2="680" y2="220" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#06B6D4" />
                    <stop offset="45%" stopColor="#2563EB" />
                    <stop offset="100%" stopColor="#7C3AED" />
                  </linearGradient>
                </defs>
                <path d="M58 205 Q58 193 69 188 L115 166 Q128 160 128 174 L128 230 Q128 239 119 243 L73 260 Q58 265 58 249 Z" fill="url(#g0_icon)" />
                <path d="M138 159 Q138 148 149 142 L213 109 Q227 102 227 118 L227 211 Q227 221 218 226 L155 258 Q138 266 138 248 Z" fill="url(#g0_icon)" />
                <path d="M230 101 L286 72 Q299 65 299 80 L299 151 Q299 159 292 164 L254 190 Q242 198 242 183 L242 125 L218 125 Q204 125 214 114 Z" fill="url(#g0_icon)" />
                <text x="350" y="194" fontFamily="Inter, sans-serif" fontSize="124" fontWeight="800" letterSpacing="-6">
                  <tspan fill="url(#g0_text)">Eme</tspan>
                  <tspan fill="#F8FAFC">Radar</tspan>
                </text>
              </svg>
            </div>
            <p className="text-xs text-slate-400 mt-3 leading-relaxed">
              原因分析：图标原本是按 320px 全高画的，高度达到 200px，而右侧文字字高（大写E）仅 90px，导致图标比文字高出 2.2 倍，视觉重心严重向左倾斜；同时原贝塞尔曲线存在不平整的凹凸变形。
            </p>
          </div>

          {/* Option A: Golden Ratio Rescale */}
          <div className="p-6 rounded-2xl bg-slate-800/80 border border-emerald-500/40 hover:border-emerald-500 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>方案 A：黄金比例精修（等比缩小 45%，对齐文字顶底）</span>
              </span>
              <span className="text-xs text-emerald-400 font-mono font-semibold">推荐：保留原造型，解决大与失衡</span>
            </div>
            <div className="p-6 rounded-xl bg-slate-950 flex items-center justify-center border border-slate-800">
              <svg viewBox="0 0 1000 200" className="w-full max-w-2xl h-auto" fill="none">
                <defs>
                  <linearGradient id="ga_icon" x1="60" y1="230" x2="300" y2="70" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#7C3AED" />
                    <stop offset="35%" stopColor="#2563EB" />
                    <stop offset="68%" stopColor="#06B6D4" />
                    <stop offset="100%" stopColor="#34D399" />
                  </linearGradient>
                  <linearGradient id="ga_text" x1="200" y1="60" x2="500" y2="160" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#06B6D4" />
                    <stop offset="45%" stopColor="#2563EB" />
                    <stop offset="100%" stopColor="#7C3AED" />
                  </linearGradient>
                </defs>
                {/* Scaled down to 55% and vertically aligned */}
                <g transform="translate(40, 20) scale(0.55)">
                  <path d="M58 205 Q58 193 69 188 L115 166 Q128 160 128 174 L128 230 Q128 239 119 243 L73 260 Q58 265 58 249 Z" fill="url(#ga_icon)" />
                  <path d="M138 159 Q138 148 149 142 L213 109 Q227 102 227 118 L227 211 Q227 221 218 226 L155 258 Q138 266 138 248 Z" fill="url(#ga_icon)" />
                  <path d="M230 101 L286 72 Q299 65 299 80 L299 151 Q299 159 292 164 L254 190 Q242 198 242 183 L242 125 L218 125 Q204 125 214 114 Z" fill="url(#ga_icon)" />
                </g>
                <text x="215" y="142" fontFamily="Inter, sans-serif" fontSize="102" fontWeight="800" letterSpacing="-5">
                  <tspan fill="url(#ga_text)">Eme</tspan>
                  <tspan fill="#F8FAFC">Radar</tspan>
                </text>
              </svg>
            </div>
            <p className="text-xs text-slate-400 mt-3 leading-relaxed">
              设计特点：将图标缩放至 55%，高度降为 110px，顶部恰好比大写 E 略高 8px（符合视觉光学平衡），底部严密贴合文字基线，间距自然收紧。
            </p>
          </div>

          {/* Option B: Modern Rounded Precision Capsule Bars */}
          <div className="p-6 rounded-2xl bg-slate-800/80 border border-sky-500/40 hover:border-sky-500 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                方案 B：新锐科技脉冲（极简 3 阶几何柱，彻底消除不规则变形）
              </span>
              <span className="text-xs text-sky-400 font-mono font-semibold">现代 SaaS / 开发者工具风</span>
            </div>
            <div className="p-6 rounded-xl bg-slate-950 flex items-center justify-center border border-slate-800">
              <svg viewBox="0 0 1000 200" className="w-full max-w-2xl h-auto" fill="none">
                <defs>
                  <linearGradient id="gb_icon" x1="40" y1="160" x2="180" y2="40" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#7C3AED" />
                    <stop offset="35%" stopColor="#2563EB" />
                    <stop offset="68%" stopColor="#06B6D4" />
                    <stop offset="100%" stopColor="#34D399" />
                  </linearGradient>
                  <linearGradient id="gb_text" x1="200" y1="60" x2="500" y2="160" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#06B6D4" />
                    <stop offset="45%" stopColor="#2563EB" />
                    <stop offset="100%" stopColor="#7C3AED" />
                  </linearGradient>
                </defs>
                {/* 3 Modern Clean Geometric Bars */}
                <rect x="52" y="106" width="26" height="38" rx="13" fill="url(#gb_icon)" />
                <rect x="88" y="80" width="26" height="64" rx="13" fill="url(#gb_icon)" />
                <path d="M124 64 C124 57 132 52 138 56 L160 70 C165 73 168 78 168 84 L168 131 C168 138 162 144 155 144 L137 144 C130 144 124 138 124 131 Z" fill="url(#gb_icon)" />
                <text x="205" y="142" fontFamily="Inter, sans-serif" fontSize="102" fontWeight="800" letterSpacing="-5">
                  <tspan fill="url(#gb_text)">Eme</tspan>
                  <tspan fill="#F8FAFC">Radar</tspan>
                </text>
              </svg>
            </div>
            <p className="text-xs text-slate-400 mt-3 leading-relaxed">
              设计特点：将 3 个色块抽象为数学级精度的阶梯信号胶囊，第 3 柱带有向右上飞跃的箭头折角，完全杜绝了手绘凹凸不平的粗糙感，与现代科技产品（如 Linear / Raycast）调性一致。
            </p>
          </div>

          {/* Option C: Sonic Radar Aperture Waves */}
          <div className="p-6 rounded-2xl bg-slate-800/80 border border-purple-500/40 hover:border-purple-500 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-400">
                方案 C：声呐雷达探测波（圆弧同心脉冲，契合 Radar 词义）
              </span>
              <span className="text-xs text-purple-400 font-mono font-semibold">深空声呐探索风</span>
            </div>
            <div className="p-6 rounded-xl bg-slate-950 flex items-center justify-center border border-slate-800">
              <svg viewBox="0 0 1000 200" className="w-full max-w-2xl h-auto" fill="none">
                <defs>
                  <linearGradient id="gc_icon" x1="40" y1="160" x2="180" y2="40" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#7C3AED" />
                    <stop offset="35%" stopColor="#2563EB" />
                    <stop offset="68%" stopColor="#06B6D4" />
                    <stop offset="100%" stopColor="#34D399" />
                  </linearGradient>
                  <linearGradient id="gc_text" x1="200" y1="60" x2="500" y2="160" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#06B6D4" />
                    <stop offset="45%" stopColor="#2563EB" />
                    <stop offset="100%" stopColor="#7C3AED" />
                  </linearGradient>
                </defs>
                {/* Radar Sonar Origin Dot & Expanding Waves */}
                <circle cx="68" cy="126" r="14" fill="url(#gc_icon)" />
                <path d="M72 92 A 38 38 0 0 1 110 130" stroke="url(#gc_icon)" strokeWidth="14" strokeLinecap="round" />
                <path d="M74 58 A 72 72 0 0 1 146 130" stroke="url(#gc_icon)" strokeWidth="14" strokeLinecap="round" />
                <text x="185" y="142" fontFamily="Inter, sans-serif" fontSize="102" fontWeight="800" letterSpacing="-5">
                  <tspan fill="url(#gc_text)">Eme</tspan>
                  <tspan fill="#F8FAFC">Radar</tspan>
                </text>
              </svg>
            </div>
            <p className="text-xs text-slate-400 mt-3 leading-relaxed">
              设计特点：直接使用声呐/雷达扫描辐射波的经典几何造型，左下角代表“搜索痛点奇点”，右上扩散弧线代表“市场雷达发现”，高度严格约束在 85px。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
