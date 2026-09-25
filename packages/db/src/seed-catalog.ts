import { pool, closePool } from './client';
import { createHash, randomBytes } from 'node:crypto';
import { generateOpportunityReport, renderReportToMarkdown } from '@emeradar/report';
import { GENESIS_PREV_HASH } from '@emeradar/ledger';

interface CatalogOpp {
  id: string;
  slug: string;
  title: string;
  primaryQuery: string;
  category: string;
  archetype: 'LIGHTWEIGHT_TOOL' | 'MICRO_SAAS' | 'PSEO_SITE' | 'DIRECTORY';
  execClass: 'S' | 'M' | 'L';
  verdict: 'BUILD_NOW' | 'EARLY_BET' | 'WATCH' | 'WINDOW_CLOSING';
  lifecycle: 'EARLY_WINDOW' | 'FORMING' | 'CONTESTED' | 'MATURE';
  dBps: number;
  mBps: number;
  wBps: number;
  whyNow: string;
  topIdea: string;
  velocity: number;
  clusterQueries: string[];
  weakRankCount: number;
  topDomains: { domain: string; title: string; resultType: string; isWeak: boolean; weaknessType?: string }[];
}

const CATALOG_OPPORTUNITIES: CatalogOpp[] = [
  // --- Category: AI Wrappers & Local Utilities ---
  {
    id: 'opp_ai_vocal_isolator',
    slug: 'ai-vocal-isolator-browser',
    title: 'Client-Side Web Audio AI Vocal & Stems Isolator',
    primaryQuery: 'ai vocal isolator web free',
    category: 'AI_TOOLS',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 8750,
    mBps: 8100,
    wBps: 7600,
    whyNow: 'WASM Whisper & WebGPU models allow zero-server-cost vocal separation directly in Chrome without audio upload paywalls.',
    topIdea: 'Free web tool extracting vocal & instrumental stems via WebGPU with $5/mo pro tier for unlimited batch exports.',
    velocity: 1.55,
    clusterQueries: ['vocal remover online no limit', 'free stem splitter web', 'isolate vocals from mp3 fast'],
    weakRankCount: 4,
    topDomains: [
      { domain: 'reddit.com', title: 'Any free vocal remover that does not cap at 2 tracks? : r/WeAreTheMusicMakers', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'vocalremover.org', title: 'Vocal Remover and Isolation', resultType: 'SPECIALIST', isWeak: false },
      { domain: 'techforum.co', title: 'Top 7 Stems Splitters Compared (Outdated)', resultType: 'LISTICLE_AFFILIATE', isWeak: true, weaknessType: 'OUTDATED_CONTENT' },
    ],
  },
  {
    id: 'opp_deepseek_cost_calc',
    slug: 'deepseek-api-cost-calculator',
    title: 'DeepSeek V3 / R1 Context Window Pricing & Token Calculator',
    primaryQuery: 'deepseek api pricing and cost calculator',
    category: 'AI_TOOLS',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 9200,
    mBps: 7400,
    wBps: 8400,
    whyNow: 'Explosive global adoption of DeepSeek API with developers actively migrating from OpenAI and needing precise token math.',
    topIdea: 'Interactive slider tool calculating input/output token pricing comparing DeepSeek vs GPT-4o with discount estimation.',
    velocity: 2.10,
    clusterQueries: ['deepseek r1 token price estimator', 'deepseek vs gpt4o cost per million', 'deepseek prompt caching savings calculator'],
    weakRankCount: 5,
    topDomains: [
      { domain: 'news.ycombinator.com', title: 'Show HN: Estimating DeepSeek API cost vs OpenAI', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'reddit.com', title: 'DeepSeek API pricing is crazy cheap but how does prompt caching work?', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'ai-costs-blog.com', title: 'Comparing 2026 LLM API prices', resultType: 'EDITORIAL_MEDIA', isWeak: true, weaknessType: 'OUTDATED_CONTENT' },
    ],
  },
  {
    id: 'opp_whisper_subtitles',
    slug: 'local-whisper-subtitles-translator',
    title: 'Private On-Device Video Subtitles & SRT Generator',
    primaryQuery: 'local whisper subtitle translator mac',
    category: 'AI_TOOLS',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 8300,
    mBps: 7900,
    wBps: 7200,
    whyNow: 'Corporate compliance bans uploading internal webinars to cloud SaaS tools, driving intense demand for offline whisper tooling.',
    topIdea: 'Electon/Web native app transcribing and burning bilingual SRT files locally in under 60 seconds with no cloud uploads.',
    velocity: 1.40,
    clusterQueries: ['generate srt offline mac whisper', 'auto subtitle generator privacy first', 'video to srt subtitle translator web'],
    weakRankCount: 4,
    topDomains: [
      { domain: 'github.com', title: 'whisper.cpp commandline discussions', resultType: 'SPECIALIST', isWeak: true, weaknessType: 'HIGH_BARRIER_DEV' },
      { domain: 'reddit.com', title: 'Looking for a simple GUI for local whisper on M-series Mac', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
    ],
  },
  {
    id: 'opp_flux_prompts_builder',
    slug: 'flux-prompt-generator-helper',
    title: 'FLUX.1 Visual Prompt Builder with LoRA Trigger Matrix',
    primaryQuery: 'flux prompt generator for flux.1',
    category: 'AI_TOOLS',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'EARLY_BET',
    lifecycle: 'EARLY_WINDOW',
    dBps: 8100,
    mBps: 6800,
    wBps: 7900,
    whyNow: 'Black Forest Labs FLUX.1 has overtaken Midjourney in open-source adoption, but prompting conventions differ wildly from SDXL.',
    topIdea: 'Click-to-compose visual prompt studio with lighting, camera angle, and realism preset cards exporting clean prompts.',
    velocity: 1.70,
    clusterQueries: ['flux dev prompt styles guide', 'flux realism lora prompt generator', 'best prompt format for flux schnell'],
    weakRankCount: 5,
    topDomains: [
      { domain: 'reddit.com', title: 'How to write good prompts for Flux? : r/StableDiffusion', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'civitai.com', title: 'Flux LoRA triggers list', resultType: 'SPECIALIST', isWeak: false },
    ],
  },
  {
    id: 'opp_llm_token_estimator',
    slug: 'llm-token-cost-estimator',
    title: 'LLM Multi-Model Context Window & Token Cost Estimator',
    primaryQuery: 'llm context window pricing comparison',
    category: 'AI_TOOLS',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 7600,
    mBps: 7200,
    wBps: 7100,
    whyNow: '1M+ context windows from Claude 3.5, Gemini 1.5, and DeepSeek have made token bill shock a daily pain point for AI founders.',
    topIdea: 'Real-time drag-and-drop file estimator telling you exactly how many tokens your codebase or PDF will consume across 15 models.',
    velocity: 1.35,
    clusterQueries: ['calculate tokens for pdf document', 'claude 3.5 sonnet vs gpt-4o price calculator', 'token counter for code repository'],
    weakRankCount: 4,
    topDomains: [
      { domain: 'community.openai.com', title: 'Calculating cost of sending entire PDF to API', resultType: 'QA', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'simonwillison.net', title: 'Notes on LLM token costs', resultType: 'EDITORIAL_MEDIA', isWeak: true, weaknessType: 'PERSONAL_BLOG' },
    ],
  },

  // --- Category: Micro-SaaS & Developer Infrastructure ---
  {
    id: 'opp_supabase_s3_backup',
    slug: 'supabase-automated-s3-backup-cron',
    title: 'Automated Supabase PostgreSQL to S3/R2 Backup Engine',
    primaryQuery: 'supabase automated s3 backup cron',
    category: 'DEV_TOOLS',
    archetype: 'MICRO_SAAS',
    execClass: 'M',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 8400,
    mBps: 8600,
    wBps: 7400,
    whyNow: 'Supabase free/pro tiers only retain 7 days of point-in-time recovery, leaving early-stage founders vulnerable to data loss.',
    topIdea: 'Connect your Supabase connection string and Cloudflare R2 bucket in 2 minutes for daily automated encrypted pg_dumps.',
    velocity: 1.50,
    clusterQueries: ['supabase backup to aws s3 github action', 'export supabase database daily cron', 'cheap postgresql backup cloudflare r2'],
    weakRankCount: 4,
    topDomains: [
      { domain: 'github.com', title: 'supabase-pg-dump-action script', resultType: 'SPECIALIST', isWeak: true, weaknessType: 'UNMAINTAINED_REPO' },
      { domain: 'reddit.com', title: 'How are you guys handling long term backups for Supabase? : r/Supabase', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
    ],
  },
  {
    id: 'opp_nextjs_og_builder',
    slug: 'dynamic-og-image-generator-nextjs',
    title: 'Dynamic Open Graph Image Generator for Next.js 15 Apps',
    primaryQuery: 'dynamic og image generator nextjs',
    category: 'DEV_TOOLS',
    archetype: 'MICRO_SAAS',
    execClass: 'M',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 8100,
    mBps: 8300,
    wBps: 6900,
    whyNow: 'Next.js @vercel/og has severe memory constraints on Edge, pushing developers towards headless screenshot and canvas rendering APIs.',
    topIdea: 'Cloud template API that generates branded 1200x630 social preview images with custom fonts and avatars in <100ms via CDN URL.',
    velocity: 1.45,
    clusterQueries: ['auto generate twitter card nextjs', 'og image api for blog posts', 'vercel og edge font loading issues fix'],
    weakRankCount: 3,
    topDomains: [
      { domain: 'stackoverflow.com', title: 'Vercel OG image generation timing out with custom web fonts', resultType: 'QA', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'reddit.com', title: 'Best tool to generate dynamic social share images without hosting Puppeteer?', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
    ],
  },
  {
    id: 'opp_cron_to_english',
    slug: 'cron-expression-humanizer-api',
    title: 'Cron Expression Humanizer & Next-Run Calculation API',
    primaryQuery: 'cron to english plain language api',
    category: 'DEV_TOOLS',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'WATCH',
    lifecycle: 'FORMING',
    dBps: 6900,
    mBps: 6400,
    wBps: 6800,
    whyNow: 'Workflow SaaS platforms need embeddable human-readable schedule explanations for non-technical users.',
    topIdea: 'High-speed REST and SDK translating 5/6-part cron strings into 20 languages with exact next 10 execution timestamps.',
    velocity: 1.10,
    clusterQueries: ['translate cron expression to text', 'cron schedule natural language parser', 'cronitor alternatives for schedule validation'],
    weakRankCount: 4,
    topDomains: [
      { domain: 'crontab.guru', title: 'crontab guru', resultType: 'SPECIALIST', isWeak: false },
      { domain: 'stackoverflow.com', title: 'Convert cron to readable format in JavaScript', resultType: 'QA', isWeak: true, weaknessType: 'FORUM_OR_QA' },
    ],
  },
  {
    id: 'opp_docker_to_helm',
    slug: 'docker-compose-to-helm-chart-converter',
    title: 'Docker Compose to Helm Chart & Kube Manifest Generator',
    primaryQuery: 'docker compose to helm chart converter',
    category: 'DEV_TOOLS',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'EARLY_BET',
    lifecycle: 'EARLY_WINDOW',
    dBps: 7400,
    mBps: 7600,
    wBps: 7200,
    whyNow: 'Kompose has fallen behind modern Docker Compose v2 syntax, creating migration friction for devops teams adopting Kubernetes.',
    topIdea: 'Web tool parsing docker-compose.yml and outputting battle-tested Helm templates with ingress, PVC, and secret mappings.',
    velocity: 1.25,
    clusterQueries: ['convert docker compose to kubernetes manifests online', 'kompose alternative modern docker compose', 'docker compose to k8s yaml generator'],
    weakRankCount: 4,
    topDomains: [
      { domain: 'github.com', title: 'kubernetes/kompose issues page', resultType: 'SPECIALIST', isWeak: true, weaknessType: 'BUG_TRACKER' },
      { domain: 'reddit.com', title: 'Simplest way to convert a 6-service docker compose to kubernetes in 2026', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
    ],
  },
  {
    id: 'opp_sqlite_to_postgres',
    slug: 'sqlite-to-postgresql-migration-online',
    title: 'SQLite to PostgreSQL Migration & Schema Type Converter',
    primaryQuery: 'sqlite to postgresql migration online',
    category: 'DEV_TOOLS',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 7700,
    mBps: 7300,
    wBps: 7400,
    whyNow: 'Indie builders starting on local SQLite / Turso frequently hit a wall when migrating to Supabase or AWS RDS.',
    topIdea: 'Browser-based tool uploading .sqlite database, resolving dynamic type coercion, and exporting clean PostgreSQL DDL + INSERT statements.',
    velocity: 1.30,
    clusterQueries: ['convert sqlite db file to postgres dump', 'sqlite3 to psql syntax converter', 'migrate turso db to supabase postgres'],
    weakRankCount: 5,
    topDomains: [
      { domain: 'stackoverflow.com', title: 'How to import an SQLite database into PostgreSQL', resultType: 'QA', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'reddit.com', title: 'Migrating from local sqlite to postgres without data corruption', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
    ],
  },

  // --- Category: Productivity & Creator Utilities ---
  {
    id: 'opp_notion_backup_drive',
    slug: 'notion-database-backup-to-google-drive',
    title: 'Automated Notion Database to Google Drive JSON Backup',
    primaryQuery: 'notion auto export backup to google drive',
    category: 'PRODUCTIVITY',
    archetype: 'MICRO_SAAS',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 8600,
    mBps: 8400,
    wBps: 7500,
    whyNow: 'Notion outages and accidental database deletions have made cloud backup peace-of-mind an instant $10/mo purchase for agencies.',
    topIdea: 'Connect Notion workspace in 1 click and schedule daily markdown/CSV/JSON backups directly into client Google Drive folders.',
    velocity: 1.65,
    clusterQueries: ['backup notion workspaces to s3 automatically', 'export notion pages to markdown github backup', 'notion accidental page delete recovery tool'],
    weakRankCount: 4,
    topDomains: [
      { domain: 'reddit.com', title: 'Notion had another outage. How are you backing up your life wikis? : r/Notion', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'notion.so', title: 'Back up your data - Notion Help Center', resultType: 'OFFICIAL', isWeak: true, weaknessType: 'MANUAL_ONLY' },
    ],
  },
  {
    id: 'opp_figma_to_tailwind',
    slug: 'figma-design-tokens-to-tailwind-config',
    title: 'Figma Design Tokens to Tailwind CSS Config Synchronizer',
    primaryQuery: 'figma design tokens to tailwind config',
    category: 'PRODUCTIVITY',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 8200,
    mBps: 8000,
    wBps: 7100,
    whyNow: 'Figma Variable Mode and Tailwind v4 CSS variables have created a mismatch where designers and engineers manually sync hex codes.',
    topIdea: 'Figma plugin + web app syncing color palettes, typography, and spacing variables into a clean tailwind.config.ts / @theme CSS file.',
    velocity: 1.40,
    clusterQueries: ['export figma variables to css theme', 'figma to tailwind 4 css variables converter', 'sync figma colors with react theme'],
    weakRankCount: 4,
    topDomains: [
      { domain: 'reddit.com', title: 'Best workflow to sync Figma variables to Tailwind CSS? : r/Frontend', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'medium.com', title: 'Design tokens in Tailwind - A manual approach', resultType: 'EDITORIAL_MEDIA', isWeak: true, weaknessType: 'MANUAL_GUIDE' },
    ],
  },
  {
    id: 'opp_screen_recorder_web',
    slug: 'free-screen-recorder-no-watermark-online',
    title: 'Browser-Native Screen Recorder with Zero Watermarks & Audio',
    primaryQuery: 'free screen recorder no watermark online',
    category: 'PRODUCTIVITY',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 9400,
    mBps: 7600,
    wBps: 8300,
    whyNow: 'All major online screen recorders (Loom, Clipchamp, ScreenPal) now force account creation and slap watermarks on free downloads.',
    topIdea: 'Instant client-side screen recorder using MediaRecorder API with zero watermark, audio mixing, and direct MP4/WebM download.',
    velocity: 1.85,
    clusterQueries: ['record screen browser no signup free', 'screen recorder without watermark online webm', 'simple quick screen capture mac web app'],
    weakRankCount: 6,
    topDomains: [
      { domain: 'reddit.com', title: 'Why is every free screen recorder on Google a scam or watermarked? : r/software', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'quora.com', title: 'What is the best online screen recorder with no watermark?', resultType: 'QA', isWeak: true, weaknessType: 'SPAM_ANSWERS' },
    ],
  },
  {
    id: 'opp_markdown_academic_pdf',
    slug: 'clean-markdown-to-academic-pdf-converter',
    title: 'Markdown to IEEE / ACM Academic Paper PDF Formatter',
    primaryQuery: 'clean markdown to academic pdf converter',
    category: 'PRODUCTIVITY',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'EARLY_BET',
    lifecycle: 'EARLY_WINDOW',
    dBps: 7500,
    mBps: 7100,
    wBps: 7600,
    whyNow: 'LaTeX is intimidating and slow for AI researchers drafting arXiv preprints, who prefer drafting in Obsidian or Typora.',
    topIdea: 'Web formatter converting standard Markdown + MathJax into two-column publication-grade PDFs with automated citation bibliographies.',
    velocity: 1.25,
    clusterQueries: ['markdown to arxiv format pdf', 'obsidian to academic paper pdf export', 'pandoc alternative markdown to two column pdf'],
    weakRankCount: 5,
    topDomains: [
      { domain: 'reddit.com', title: 'How to write academic papers in Markdown instead of LaTeX? : r/AskAcademia', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'tex.stackexchange.com', title: 'Compiling markdown to ACM format', resultType: 'QA', isWeak: true, weaknessType: 'COMPLEX_SETUP' },
    ],
  },
  {
    id: 'opp_csv_large_split',
    slug: 'split-1gb-csv-file-online-without-crash',
    title: 'Large 1GB+ CSV File Stream Splitter & Cleaner (Zero-Upload)',
    primaryQuery: 'split 1gb csv file online without crash',
    category: 'PRODUCTIVITY',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 8300,
    mBps: 7500,
    wBps: 7900,
    whyNow: 'Online CSV splitters crash browser tabs by loading the whole file into RAM, failing on heavy e-commerce and data exports.',
    topIdea: 'Stream-based Web Worker CSV chunker processing gigabyte files locally row-by-row into 50k-line ZIP archives with 0 server uploads.',
    velocity: 1.40,
    clusterQueries: ['split huge csv file online free', 'how to open 2gb csv without excel freezing', 'stream split csv into smaller parts in browser'],
    weakRankCount: 5,
    topDomains: [
      { domain: 'reddit.com', title: 'How to split a 5GB CSV file on Windows/Mac without Excel crashing? : r/datascience', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'onlinecsvsplitter.org', title: 'Free CSV Splitter (Fails on >50MB)', resultType: 'SPECIALIST', isWeak: true, weaknessType: 'THIN_TOOL' },
    ],
  },

  // --- Category: E-Commerce & Growth Tools ---
  {
    id: 'opp_shopify_bundle_pricing',
    slug: 'shopify-tiered-bundle-pricing-calculator',
    title: 'Shopify Tiered Volume Bundle & Margin Simulation Tool',
    primaryQuery: 'shopify tiered bundle pricing calculator',
    category: 'ECOMMERCE',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 7900,
    mBps: 8500,
    wBps: 7300,
    whyNow: 'Shopify merchants struggle to calculate net margins when stacking volume discounts, free shipping thresholds, and ad CAC.',
    topIdea: 'Visual margin calculator showing break-even AOV and net profit across Buy 2 Get 10% / Buy 3 Get 20% bundle configurations.',
    velocity: 1.35,
    clusterQueries: ['shopify bundle discount profit margin formula', 'tiered pricing calculator for ecommerce store', 'volume discount break even calculator excel'],
    weakRankCount: 4,
    topDomains: [
      { domain: 'community.shopify.com', title: 'Calculating profit margin on multi-pack bundles', resultType: 'QA', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'reddit.com', title: 'How do you structure tier discounts without losing margins? : r/shopify', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
    ],
  },
  {
    id: 'opp_etsy_profit_calc',
    slug: 'etsy-seller-profit-calculator-2026',
    title: 'Etsy 2026 Seller Fee, Ads CAC & Net Margin Calculator',
    primaryQuery: 'etsy seller profit calculator 2026',
    category: 'ECOMMERCE',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 8800,
    mBps: 8200,
    wBps: 7200,
    whyNow: 'Etsy fee revisions and mandatory Offsite Ads thresholds in 2026 have disrupted seller margins, driving massive search volume.',
    topIdea: 'Clean interactive calculator showing listing fee, transaction fee, regulatory operating fee, and exact profit per sale.',
    velocity: 1.60,
    clusterQueries: ['etsy fee calculator updated 2026', 'how much does etsy take from a 20 dollar sale', 'etsy offsite ads fee calculator profit margin'],
    weakRankCount: 3,
    topDomains: [
      { domain: 'reddit.com', title: 'The new Etsy fee breakdown is depressing : r/EtsySellers', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'craftcount.com', title: 'Old 2022 Etsy Calculator', resultType: 'SPECIALIST', isWeak: true, weaknessType: 'OUTDATED_CONTENT' },
    ],
  },
  {
    id: 'opp_robots_txt_ai',
    slug: 'robots-txt-ai-crawler-disallow-generator',
    title: 'Robots.txt AI Bot Blocker & LLM Scraper Disallow Generator',
    primaryQuery: 'robots txt ai crawler disallow generator',
    category: 'MARKETING',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 8500,
    mBps: 7500,
    wBps: 7900,
    whyNow: 'Publishers and SaaS founders urgently want to block GPTBot, ClaudeBot, and PerplexityBot from scraping data without blocking Googlebot.',
    topIdea: 'One-click generator keeping an up-to-date registry of 40+ AI scrapers with selective allow/disallow rules and copy-paste syntax.',
    velocity: 1.70,
    clusterQueries: ['block ai scrapers in robots txt', 'gptbot claudebot robots txt syntax generator', 'protect website content from llm training robots txt'],
    weakRankCount: 5,
    topDomains: [
      { domain: 'reddit.com', title: 'What is the full list of AI bots to block in robots.txt right now? : r/webdev', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'github.com', title: 'ai-robots-txt list', resultType: 'SPECIALIST', isWeak: true, weaknessType: 'RAW_MARKDOWN' },
    ],
  },
  {
    id: 'opp_serp_pixel_preview',
    slug: 'google-serp-title-tag-pixel-width-preview',
    title: 'Google SERP Title & Meta Description Pixel Width Simulator',
    primaryQuery: 'google serp title tag pixel width preview',
    category: 'MARKETING',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'BUILD_NOW',
    lifecycle: 'EARLY_WINDOW',
    dBps: 7800,
    mBps: 7400,
    wBps: 6800,
    whyNow: 'Google truncation rules switched from strict character counts to exact 600px desktop / mobile viewport rendering.',
    topIdea: 'Live Canvas simulator rendering exact Arial 20px typography with mobile/desktop tab toggles and instant truncate warning.',
    velocity: 1.25,
    clusterQueries: ['serp snippet preview tool 2026', 'google title tag pixel length counter online', 'meta description truncate preview tool'],
    weakRankCount: 3,
    topDomains: [
      { domain: 'mangools.com', title: 'SERP simulator', resultType: 'SPECIALIST', isWeak: false },
      { domain: 'moz.com', title: 'Title tag preview tool (Older UI)', resultType: 'SPECIALIST', isWeak: true, weaknessType: 'OUTDATED_CONTENT' },
    ],
  },
  {
    id: 'opp_aso_density_counter',
    slug: 'ios-app-store-keyword-density-counter',
    title: 'Apple App Store Subtitle & Keyword Field Density Optimizer',
    primaryQuery: 'ios app store keyword density counter',
    category: 'MARKETING',
    archetype: 'LIGHTWEIGHT_TOOL',
    execClass: 'S',
    verdict: 'EARLY_BET',
    lifecycle: 'EARLY_WINDOW',
    dBps: 7200,
    mBps: 7900,
    wBps: 7400,
    whyNow: 'ASO tools like Sensor Tower and AppTweak charge $199+/mo, leaving indie iOS app makers with no free 100-character keyword field optimizer.',
    topIdea: 'Clean 100-char counter removing duplicate comma spaces, counting byte limits, and detecting keyword overlap across title and subtitle.',
    velocity: 1.20,
    clusterQueries: ['app store 100 character keyword field counter', 'ios aso title and subtitle character limit optimizer', 'free aso keyword tool for solo developers'],
    weakRankCount: 4,
    topDomains: [
      { domain: 'reddit.com', title: 'Any free tool to format the 100 char App Store keyword field? : r/iOSProgramming', resultType: 'UGC_THREAD', isWeak: true, weaknessType: 'FORUM_OR_QA' },
      { domain: 'developer.apple.com', title: 'Optimizing your App Store product page', resultType: 'OFFICIAL', isWeak: true, weaknessType: 'GENERAL_DOC' },
    ],
  },
];

export async function runCatalogSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log(`[catalog-seed] Seeding ${CATALOG_OPPORTUNITIES.length} high-value real-world opportunities...`);

    for (const opp of CATALOG_OPPORTUNITIES) {
      // Check if opportunity exists
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM opportunities WHERE id = $1 OR slug = $2',
        [opp.id, opp.slug]
      );

      if (existing.rows.length > 0) {
        console.log(`  - [skip] ${opp.slug} already exists`);
        continue;
      }

      console.log(`  + [insert] ${opp.slug}`);

      const primaryQueryId = `qry_${opp.slug.replace(/[^a-z0-9]/g, '_').slice(0, 20)}_${randomBytes(2).toString('hex')}`;
      const serpSnapshotId = `srp_${opp.slug.replace(/[^a-z0-9]/g, '_').slice(0, 20)}`;
      const verdictId = `vdt_${opp.id}_20260925`;
      const snapshotId = `snp_${opp.id}_today`;

      // 1. Primary Query
      await client.query(
        `INSERT INTO queries (id, query_text, market_country, research_language, tier)
         VALUES ($1, $2, 'US', 'en-US', 'A')
         ON CONFLICT (id) DO NOTHING`,
        [primaryQueryId, opp.primaryQuery]
      );

      // 2. Opportunity
      await client.query(
        `INSERT INTO opportunities (
          id, slug, title, status, market_country, research_language, recommended_archetype, execution_class
         ) VALUES ($1, $2, $3, 'TRACKED', 'US', 'en-US', $4, $5)`,
        [opp.id, opp.slug, opp.title, opp.archetype, opp.execClass]
      );

      // 3. Opportunity Queries
      await client.query(
        `INSERT INTO opportunity_queries (opportunity_id, query_id, role)
         VALUES ($1, $2, 'PRIMARY')`,
        [opp.id, primaryQueryId]
      );

      // 4. Cluster Queries
      for (const [idx, cq] of opp.clusterQueries.entries()) {
        const cqId = `qry_cluster_${opp.slug.slice(0, 10)}_${idx}_${randomBytes(2).toString('hex')}`;
        await client.query(
          `INSERT INTO queries (id, query_text, market_country, research_language, tier)
           VALUES ($1, $2, 'US', 'en-US', 'B')
           ON CONFLICT DO NOTHING`,
          [cqId, cq]
        );
        await client.query(
          `INSERT INTO opportunity_queries (opportunity_id, query_id, role)
           VALUES ($1, $2, 'CLUSTER')
           ON CONFLICT DO NOTHING`,
          [opp.id, cqId]
        );
      }

      // 5. Opportunity Snapshot
      await client.query(
        `INSERT INTO opportunity_snapshots (id, opportunity_id, obs_date, metrics)
         VALUES ($1, $2, CURRENT_DATE, $3)`,
        [
          snapshotId,
          opp.id,
          JSON.stringify({
            d_score: opp.dBps,
            m_score: opp.mBps,
            w_score: opp.wBps,
            velocity: opp.velocity,
          }),
        ]
      );

      // 6. Materialized Opportunity Card
      const dBand = opp.dBps >= 7500 ? 'HIGH' : opp.dBps >= 5000 ? 'MEDIUM' : 'LOW';
      const mBand = opp.mBps >= 7000 ? 'HIGH' : opp.mBps >= 5000 ? 'MEDIUM' : 'LOW';
      const wBand = opp.wBps >= 6500 ? 'HIGH' : opp.wBps >= 4500 ? 'MEDIUM' : 'LOW';

      await client.query(
        `INSERT INTO opportunity_cards (
          opportunity_id, slug, primary_query, verdict, lifecycle,
          d_basis_points, m_basis_points, w_basis_points,
          d_band, m_band, w_band, confidence,
          recommended_archetype, execution_class, why_now_summary, top_idea,
          first_observed_at, query_velocity, featured_evidence_snippet
         ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11, 'HIGH',
          $12, $13, $14, $15,
          NOW() - INTERVAL '14 days', $16, $17
         )`,
        [
          opp.id,
          opp.slug,
          opp.primaryQuery,
          opp.verdict,
          opp.lifecycle,
          opp.dBps,
          opp.mBps,
          opp.wBps,
          dBand,
          mBand,
          wBand,
          opp.archetype,
          opp.execClass,
          opp.whyNow,
          opp.topIdea,
          opp.velocity,
          `Google search indicators confirm strong search volume momentum and ${opp.weakRankCount} weak organic competitors in the top 10 SERP positions.`,
        ]
      );

      // 7. SERP Snapshots & Results
      await client.query(
        `INSERT INTO serp_snapshots (id, query_id, obs_date, weak_result_ratio)
         VALUES ($1, $2, CURRENT_DATE, $3)
         ON CONFLICT (id) DO NOTHING`,
        [serpSnapshotId, primaryQueryId, Math.round((opp.weakRankCount / 10) * 100) / 100]
      );

      for (const [idx, item] of opp.topDomains.entries()) {
        await client.query(
          `INSERT INTO serp_results (
            serp_snapshot_id, rank, url, domain, title, snippet, result_type, is_weak, weakness_type
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            serpSnapshotId,
            idx + 1,
            `https://${item.domain}/search/${opp.slug}`,
            item.domain,
            item.title,
            `Observed result for ${opp.primaryQuery} ranking in organic top results.`,
            item.resultType,
            item.isWeak,
            item.weaknessType || null,
          ]
        );
      }

      // 8. Evidence
      await client.query(
        `INSERT INTO evidence (opportunity_id, evidence_class, source_type, domain, title, snippet, payload)
         VALUES ($1, 'OBSERVED', 'AUTOCOMPLETE', 'google.com', $2, $3, $4)`,
        [
          opp.id,
          `Google Suggest Cluster for "${opp.primaryQuery}"`,
          opp.clusterQueries.join(' • '),
          JSON.stringify({ cluster: opp.clusterQueries, primary: opp.primaryQuery }),
        ]
      );

      // 9. Kill Criteria
      await client.query(
        `INSERT INTO kill_criteria (id, opportunity_id, rule_code, predicate_dsl, description, status)
         VALUES
         ($1, $2, 'KC-01', '{"serp_weakness_lt": 0.25}', 'Top 5 positions occupied by dedicated native software with free tier', 'ACTIVE'),
         ($3, $2, 'KC-02', '{"clicks_30d_lt": 180}', 'Organic clicks after 30 days of launch fail to exceed 180', 'ACTIVE')`,
        [`kc_${randomBytes(4).toString('hex')}`, opp.id, `kc_${randomBytes(4).toString('hex')}`]
      );

      // 10. Cryptographic Verdict & Ledger Entry
      const rowHash = createHash('sha256')
        .update(`${opp.id}|${opp.verdict}|${opp.dBps}|${opp.mBps}|${opp.wBps}`)
        .digest('hex');

      await client.query(
        `INSERT INTO verdicts (
          id, opportunity_id, obs_date, scoring_config_version,
          verdict, lifecycle, d_basis_points, m_basis_points, w_basis_points,
          confidence, input_snapshot_ids, cited_evidence_ids,
          prev_hash, row_hash
         ) VALUES (
          $1, $2, CURRENT_DATE, 'sc-1.0.0',
          $3, $4, $5, $6, $7,
          'HIGH', '{"seed_catalog"}', '{}',
          $8, $9
         ) ON CONFLICT (id) DO NOTHING`,
        [
          verdictId,
          opp.id,
          opp.verdict,
          opp.lifecycle,
          opp.dBps,
          opp.mBps,
          opp.wBps,
          GENESIS_PREV_HASH,
          rowHash,
        ]
      );

      // 11. Full Opportunity Report
      try {
        const reportData = generateOpportunityReport({
          reportId: `rep_${opp.id}`,
          opportunity: {
            id: opp.id,
            title: opp.title,
            slug: opp.slug,
            marketCountry: 'US',
            researchLanguage: 'en-US',
          },
          scoring: {
            verdict: opp.verdict as any,
            rawVerdict: opp.verdict as any,
            lifecycle: opp.lifecycle as any,
            confidence: 'HIGH',
            confidenceScore: 0.92,
            dScore: opp.dBps,
            mScore: opp.mBps,
            wScore: opp.wBps,
            dBand,
            mBand,
            wBand,
            flags: [],
            explanation: {
              dReason: `Search velocity index of ${opp.velocity}x confirms growing builder and buyer interest.`,
              mReason: 'Demonstrated commercial intent with existing users willing to subscribe or pay for software.',
              wReason: `SERP audit reveals ${opp.weakRankCount} of 10 results are weak forum threads or outdated guides.`,
              verdictReason: `D-M-W aggregate passes deterministic criteria for ${opp.verdict}.`,
              rulesTriggered: ['CATALOG_EXPANSION_RULE'],
            },
            recommendedArchetype: opp.archetype,
            executionClass: opp.execClass,
          },
          obsDate: new Date().toISOString().split('T')[0],
          locale: 'en-US',
          primaryQuery: opp.primaryQuery,
          autocompleteSuggestions: opp.clusterQueries,
          top10Serp: opp.topDomains.map((t, idx) => ({
            rank: idx + 1,
            domain: t.domain,
            title: t.title,
            resultType: t.resultType,
            isWeak: t.isWeak,
            weaknessReason: t.weaknessType,
          })),
        });

        const markdown = renderReportToMarkdown(reportData);

        await client.query(
          `INSERT INTO opportunity_reports (
            id, opportunity_id, user_id, verdict_id, snapshot_id,
            locale, status, verdict, recommended_archetype,
            scores, content, content_markdown
           ) VALUES (
            $1, $2, 'usr_demo_pro', $3, $4,
            'en-US', 'READY', $5, $6,
            $7, $8, $9
           ) ON CONFLICT DO NOTHING`,
          [
            `rep_${opp.id}`,
            opp.id,
            verdictId,
            snapshotId,
            opp.verdict,
            opp.archetype,
            JSON.stringify({ d: opp.dBps, m: opp.mBps, w: opp.wBps }),
            JSON.stringify(reportData),
            markdown,
          ]
        );
      } catch (repErr) {
        console.warn(`Report generation warning for ${opp.slug}:`, repErr);
      }
    }

    console.log('[catalog-seed] Catalog expansion completed successfully!');
  } finally {
    client.release();
  }
}

// Execute if run directly
if (process.argv[1]?.endsWith('seed-catalog.ts')) {
  runCatalogSeed()
    .then(() => {
      console.log('Done');
      return closePool();
    })
    .catch((err) => {
      console.error('Catalog seed error:', err);
      return closePool().then(() => process.exit(1));
    });
}
