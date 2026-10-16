import { createHash } from 'node:crypto';
import { BuildArchetype, EmeradarError, ErrorCode } from '@emeradar/core';
import { formatSearchIntent } from './localization';
import { createZip, dosDateFromDate, type ZipEntry } from './zip';
import type { OpportunityReportData } from './types';

/**
 * 形态点火包（Launch Kit，ADR-019、PRD F8 交付物二、09 §5.3）。
 *
 * **它不是代码生成器**，而是一份可以从冻结快照离线重算的确定性交付物：模板 +
 * 已冻结快照装配，硬数据一律由占位符注入。不生成虚构代码正文、不生成架构图、不写
 * 用户仓库、不调用任何代码执行或 MCP 能力。
 *
 * 三条硬约束贯穿本文件：
 *   1. **确定性**：同一 `(opportunity, snapshot, archetype, template_version)` 必得
 *      bit-for-bit 相同的产物。所以这里没有任何 `Date.now()`、没有随机 id、没有
 *      对象键序依赖；ZIP 的时间戳也来自快照观测日（见 `zip.ts`）。
 *   2. **占位符必须全解**（R3）：残留一个 `{{…}}` 就立刻抛错。这不是"最好如此"，
 *      而是把"模板改了但没喂数据"从一次静默的错误交付变成一次可见的失败。
 *   3. **不编数字**：本文件出现的每个数字都来自报告数据或快照标识；报告里没有的
 *      字段留 `—`，**绝不由 LLM 或本文件补齐**（09 §5.3 硬约束 4）。用户要填的地方
 *      显式写成 `TODO(you)`，而不是填一个看起来合理但无凭据的值。
 *
 * 三件交付物一一对应 09 §5.3 的表格：
 *   ① 工程规范            → `CLAUDE.md` + `.cursorrules`
 *   ② PSEO 路由与种子词表 → `routes.yaml` + `keywords.csv`
 *   ③ 着陆页骨架          → `landing-skeleton.html` + `sections.yaml`
 */

/** 模板版本。模板内容一改就要动它：它是"同一输入同一产物"承诺的一部分。 */
export const LAUNCH_KIT_TEMPLATE_VERSION = '1.1';
/** 产物结构与 03 §13 `launch_kits.schema_version` 对应。 */
export const LAUNCH_KIT_SCHEMA_VERSION = '1.0';

/** 无法指回任何证据的字段一律留这个符号，不得用编造值填空（09 §5.3 硬约束 4）。 */
export const ABSENT = '—';

export interface LaunchKitFile {
  /** 交付物内的相对路径，也是用户把它落进自己仓库时的文件名。 */
  path: string;
  mediaType: string;
  content: string;
}

/**
 * LLM 撰写的叙述段落（ADR-019：只写 ≤ 500 字）。
 *
 * 它**不进** `content_hash` 的重算路径之外——恰恰相反：叙述一旦生成就随产物一起
 * 冻结进 `files`，此后再导出只读这份冻结值，绝不重新调用 LLM。这正是 PRD P5/P7
 * 对快照标签的要求（重算严禁再调 LLM），点火包沿用同一条规则。
 */
export interface LaunchKitNarrative {
  engineering: string;
  landing: string;
}

export interface AssembleLaunchKitInput {
  report: OpportunityReportData;
  /** 用户在 GO 时选定的形态：决定装配哪一套工程规范与页面骨架（09 §5.3 硬约束 3）。 */
  archetype: BuildArchetype;
  /** 目标研究市场的语言；词表、路由与查询词一律保持它的原文，不译（14 §5.4）。 */
  researchLanguage: string;
  /** 冻结快照标识，写进产物头部供用户自查（09 §5.3 硬约束 1）。 */
  snapshotId: string;
  scoringConfigVersion: string;
  templateVersion?: string;
  narrative?: Partial<LaunchKitNarrative> | null;
}

export interface LaunchKitBundle {
  schemaVersion: string;
  templateVersion: string;
  snapshotId: string;
  scoringConfigVersion: string;
  archetype: BuildArchetype;
  researchLanguage: string;
  obsDate: string;
  files: LaunchKitFile[];
  /**
   * 本次装配用到的叙述段落，随产物一起返回以便落库。
   *
   * 它必须被存下来：叙述是装配的**输入**，而复核（"用同一份输入重装一遍"）需要把
   * 同一段文本喂回去。不存它，复核就只能从渲染好的文件里反推叙述——那是字符串
   * 手术，模板一改就失效。
   */
  narrative: LaunchKitNarrative;
  contentHash: string;
}

/**
 * 形态决定**装配形状**，而不是决定"该做什么产品"。
 *
 * 这条线必须划清：MVP 范围、技术栈、页面清单都来自报告（`section5`），本文件
 * 只决定"这三件交付物在这个形态下长什么样"。否则这里就成了"每种形态该怎么做"
 * 的第二个权威，而 05 §11.2 才是那个权威——两份同类描述必然漂移。
 *
 * 多数形态该不该铺 PSEO 路由，只有这一处判断：PSEO 型产品（目录站、内容站）的
 * 主体就是路由表；工具型与微 SaaS 的主体是少数几个落地页，簇内词是**页面文案的
 * 目标词**而不是独立路由。
 */
const PSEO_ARCHETYPES: readonly BuildArchetype[] = [
  BuildArchetype.PSEO_SITE,
  BuildArchetype.DIRECTORY,
  BuildArchetype.CONTENT_SITE,
];

const FILE_MEDIA_TYPES = {
  markdown: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  yaml: 'application/yaml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
} as const;

// ---------------------------------------------------------------------------
// 占位符
// ---------------------------------------------------------------------------

type PlaceholderScope = Record<string, string>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * 解析一份模板里的全部占位符。
 *
 * 两道守卫缺一不可：未知键要报（模板引用了没人喂的数据），残留 `{{` 也要报
 * （模板写了 `{{foo bar}}` 这种不合语法的键，正则匹配不到就会原样溜进交付物）。
 * 只做前者的话，一个手滑的空格就能让 `{{ }}` 出现在用户的 CLAUDE.md 里。
 */
function resolveTemplate(key: string, template: string, scope: PlaceholderScope): string {
  const missing = new Set<string>();
  const resolved = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = scope[name];
    if (value === undefined) {
      missing.add(name);
      return '';
    }
    return value;
  });
  if (missing.size > 0) {
    throw new EmeradarError(
      ErrorCode.INTERNAL,
      `Launch kit template "${key}" references placeholders with no value: ${[...missing].sort().join(', ')}`,
      500
    );
  }
  const residue = /{{/.exec(resolved);
  if (residue) {
    throw new EmeradarError(
      ErrorCode.INTERNAL,
      `Launch kit produced unresolved placeholder residue in "${key}" at offset ${residue.index}; refusing to export (R3).`,
      500
    );
  }
  return resolved;
}

/** 未知值一律落成 `—`，不用空串——空串在交付物里读起来像"这个字段本来就不该有"。 */
function orAbsent(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ABSENT;
  const text = String(value).trim();
  return text.length === 0 ? ABSENT : text;
}

/**
 * 查询词 → 路由 path 的确定性改写。
 *
 * 只做字符归一，不做同义词扩展、不做翻译、不去停用词：09 §5.3 硬约束 4 要求词表里
 * 只包含**已观测到**的词，任何"看起来更 SEO 的改写"都是外推。
 */
export function slugifyQuery(query: string): string {
  const slug = query
    .toLowerCase()
    .normalize('NFKD')
    // 音标符号在这里是噪音（`café` 与 `cafe` 是同一个查询），去掉后 slug 才是 ASCII。
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'index';
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function yamlString(value: string): string {
  // 单引号包裹并把内部的单引号翻倍：查询词里出现 `:`、`#`、`{` 都不会破坏结构，
  // 而双引号需要处理转义序列（`\n` 会被 YAML 解释成换行）。
  return `'${value.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

export function assembleLaunchKit(input: AssembleLaunchKitInput): LaunchKitBundle {
  const { report, archetype } = input;
  const locale = report.metadata.locale;
  const isZh = locale === 'zh-CN';
  const templateVersion = input.templateVersion ?? LAUNCH_KIT_TEMPLATE_VERSION;
  const obsDate = report.metadata.obsDate;
  const narrative: LaunchKitNarrative = {
    // 没有 LLM 叙述时用一个**不含任何事实断言**的确定性段落，而不是编一段像样的
    // 产品描述：编出来的描述会被用户当成分析结论读。
    engineering:
      input.narrative?.engineering ??
      (isZh
        ? '（本期未生成叙述段落：叙述由 08 U7 在入库阶段一次性写入并冻结，重算路径不调用 LLM。）'
        : '(No narrative was generated for this kit: the narrative is written once by 08 U7 and frozen; recomputation never calls the LLM.)'),
    landing:
      input.narrative?.landing ??
      (isZh
        ? '（本期未生成叙述段落：见上。）'
        : '(No narrative was generated: see above.)'),
  };

  const scope = buildScope(report, archetype, input, isZh, narrative, templateVersion);

  // 09 §5.3 第 6 条：没有观测到簇内词就不输出空词表。PSEO 形态的路由表完全由簇内词
  // 铺开，所以连 routes.yaml 一并省掉；其余形态的路由来自初始页面清单，仍有内容。
  const hasClusterWords = report.section2.clusterQueries.length > 0;
  const omitRoutes = !hasClusterWords && PSEO_ARCHETYPES.includes(archetype);

  const files: LaunchKitFile[] = [
    {
      path: 'CLAUDE.md',
      mediaType: FILE_MEDIA_TYPES.markdown,
      content: renderEngineeringDoc(scope, isZh, 'CLAUDE.md'),
    },
    {
      path: '.cursorrules',
      mediaType: FILE_MEDIA_TYPES.markdown,
      content: renderCursorRules(scope, isZh),
    },
    ...(omitRoutes
      ? []
      : [
          {
            path: 'routes.yaml',
            mediaType: FILE_MEDIA_TYPES.yaml,
            content: renderRoutes(scope, report, archetype, input, isZh),
          },
        ]),
    hasClusterWords
      ? {
          path: 'keywords.csv',
          mediaType: FILE_MEDIA_TYPES.csv,
          content: renderKeywordsCsv(report, input),
        }
      : {
          path: 'KEYWORDS_UNAVAILABLE.md',
          mediaType: FILE_MEDIA_TYPES.markdown,
          content: renderKeywordsUnavailable(report, input, isZh, omitRoutes),
        },
    {
      path: 'landing-skeleton.html',
      mediaType: FILE_MEDIA_TYPES.html,
      content: renderLandingSkeleton(scope, isZh),
    },
    {
      path: 'sections.yaml',
      mediaType: FILE_MEDIA_TYPES.yaml,
      content: renderSections(scope, report, isZh),
    },
  ];

  return {
    schemaVersion: LAUNCH_KIT_SCHEMA_VERSION,
    templateVersion,
    snapshotId: input.snapshotId,
    scoringConfigVersion: input.scoringConfigVersion,
    archetype,
    researchLanguage: input.researchLanguage,
    obsDate,
    files,
    narrative,
    contentHash: hashLaunchKitFiles(files, {
      templateVersion,
      snapshotId: input.snapshotId,
      scoringConfigVersion: input.scoringConfigVersion,
      archetype,
    }),
  };
}

/**
 * 产物指纹（对应 `launch_kits.content_hash`）。
 *
 * 把版本三项一起算进去是有意的：`files` 相同但模板版本不同，就不是"同一份交付物"
 * ——用户拿这个哈希去核对的就是"同一份输入得到同一份产物"这句话，而输入的定义里
 * 包含模板版本。
 *
 * 用固定分隔符拼接而不是 `JSON.stringify`：后者的键序依赖对象构造顺序，一个无关的
 * 重构就可能静默改变哈希。
 */
export function hashLaunchKitFiles(
  files: readonly LaunchKitFile[],
  versions: {
    templateVersion: string;
    snapshotId: string;
    scoringConfigVersion: string;
    archetype: string;
  }
): string {
  const hash = createHash('sha256');
  hash.update(
    ['v1', versions.templateVersion, versions.snapshotId, versions.scoringConfigVersion, versions.archetype].join('\n'),
    'utf8'
  );
  // 文件顺序与文件名一起进哈希：改名或改序都应当改变指纹。
  for (const file of files) {
    hash.update(`\n--${file.path}\n`, 'utf8');
    hash.update(file.content, 'utf8');
  }
  return hash.digest('hex');
}

/** ZIP 打包（10 §4.4 的 `format=bundle`）。 */
export function zipLaunchKit(bundle: LaunchKitBundle): Buffer {
  const entries: ZipEntry[] = bundle.files.map((file) => ({
    path: file.path,
    content: Buffer.from(file.content, 'utf8'),
  }));
  // 时间戳取自快照观测日而不是 now()：同一份输入两次打包必须字节一致（硬约束 1）。
  return createZip(entries, { dosDate: dosDateFromDate(bundle.obsDate) });
}

function buildScope(
  report: OpportunityReportData,
  archetype: BuildArchetype,
  input: AssembleLaunchKitInput,
  isZh: boolean,
  narrative: LaunchKitNarrative,
  templateVersion: string
): PlaceholderScope {
  const { metadata, section2, section3, section4, section5, section6 } = report;
  const brief = section5.executionBrief;
  const primary = section2.primaryQuery || metadata.title;

  const paid = section4.paidCompetitors;
  // 价格区间原样罗列，**不**求中位数、不四舍五入：那些 priceRange 是自由文本
  // （"$9/mo"、"from $19"），解析成数字再算中位数就是在发明一个没有证据的数字。
  const priceEvidence =
    paid.length > 0
      ? paid.map((c) => `${c.domain}: ${c.priceRange}`).join(isZh ? '；' : '; ')
      : ABSENT;
  const gateways =
    paid.length > 0
      ? [...new Set(paid.flatMap((c) => c.paymentGateways))].sort().join(', ')
      : ABSENT;

  return {
    'kit.schema_version': LAUNCH_KIT_SCHEMA_VERSION,
    'kit.template_version': templateVersion,
    'kit.snapshot_id': input.snapshotId,
    'kit.scoring_config_version': input.scoringConfigVersion,
    'kit.obs_date': report.metadata.obsDate,
    'kit.research_language': input.researchLanguage,
    'kit.locale': metadata.locale,
    'kit.archetype': archetype,
    'kit.generated_from': isZh
      ? '由冻结快照确定性装配；本文件不含任何未指回快照的推断。'
      : 'Deterministically assembled from a frozen snapshot; nothing here is inferred without a snapshot citation.',

    'opportunity.title': metadata.title,
    'opportunity.slug': metadata.slug,
    'opportunity.verdict': metadata.verdict,
    'opportunity.lifecycle': metadata.lifecycle,
    'opportunity.execution_class': metadata.executionClass,
    'opportunity.confidence': metadata.scores.confidence,
    'opportunity.d_band': orAbsent(metadata.scores.dBand),
    'opportunity.m_band': orAbsent(metadata.scores.mBand),
    'opportunity.w_band': orAbsent(metadata.scores.wBand),

    primary_query: primary,
    search_intent: formatSearchIntent(section2.searchIntent, metadata.locale),
    job_to_be_done: section2.jobToBeDone,
    product_shape: section2.recommendedProductShape,
    site_strategy: section2.siteStrategy,
    momentum: section2.momentumAssessment,
    query_velocity: String(section2.queryVelocity),

    mvp_in_scope: bullet(section5.mvpScope.inScope),
    mvp_out_of_scope: bullet(section5.mvpScope.outOfScope),
    stack_frontend: section5.recommendedStack.frontend,
    stack_backend: section5.recommendedStack.backend,
    stack_database: section5.recommendedStack.database,
    stack_hosting: section5.recommendedStack.hosting,
    sprint_plan: bullet(
      section5.sprintPlan14d.map((p) => `${p.phase} (${p.days}): ${p.deliverables.join(isZh ? '、' : ', ')}`)
    ),

    brief_core_job: brief.coreJob,
    brief_page_type: brief.mvpPageType,
    brief_core_action: brief.coreAction,
    brief_required_variants: bullet(brief.requiredVariants),
    brief_initial_pages: bullet(brief.initialPages.map((p) => `${p.path} — ${p.purpose}`)),
    brief_internal_links: bullet(brief.internalLinkPlan),
    brief_launch_checklist: checkbox(brief.launchChecklist),
    brief_non_goals: bullet(brief.nonGoals),

    weakness_score: String(section3.serpWeaknessScore),
    weak_result_ratio: `${Math.round(section3.weakResultsRatio * 100)}%`,
    vulnerability_gaps: bullet(section3.vulnerableGaps),
    serp_table: renderSerpTable(section3.top10Results, isZh),

    evidence_total: String(section4.evidenceCount.total),
    evidence_observed: String(section4.evidenceCount.observed),
    monetization_headroom: section4.monetizationHeadroom,
    price_evidence: priceEvidence,
    payment_gateways: gateways,

    kill_rules: bullet(section6.activeRules.map((r) => `${r.code}: ${r.rule}`)),
    kill_invalidation: bullet(section6.invalidationConditions),
    radar_guidance: section6.radarWatchGuidance,

    narrative_engineering: narrative.engineering,
    narrative_landing: narrative.landing,
  };
}

/**
 * 列表渲染。空列表落成 `- —` 而不是留白：交付物里的一行空白读起来像"这一节不该
 * 存在"，而 `—` 说的是"这一节存在，但没有可指回证据的内容"（硬约束 4）。
 */
function bullet(items: readonly string[]): string {
  if (items.length === 0) return `- ${ABSENT}`;
  return items.map((item) => `- ${item}`).join('\n');
}

function checkbox(items: readonly string[]): string {
  if (items.length === 0) return `- [ ] ${ABSENT}`;
  return items.map((item) => `- [ ] ${item}`).join('\n');
}

function renderSerpTable(
  rows: readonly OpportunityReportData['section3']['top10Results'][number][],
  isZh: boolean
): string {
  if (rows.length === 0) return ABSENT;
  const header = isZh
    ? `| # | 域名 | 结果类型 | 是否薄弱 |\n|---|---|---|---|`
    : `| # | Domain | Result type | Weak? |\n|---|---|---|---|`;
  const body = rows
    .map((row) => `| ${row.rank} | ${row.domain} | ${row.resultType} | ${row.isWeak ? (isZh ? '是' : 'yes') : (isZh ? '否' : 'no')} |`)
    .join('\n');
  return `${header}\n${body}`;
}

// ---------------------------------------------------------------------------
// ① 工程规范
// ---------------------------------------------------------------------------

function renderEngineeringDoc(scope: PlaceholderScope, isZh: boolean, key: string): string {
  const template = isZh
    ? `# {{opportunity.title}} — {{kit.archetype}} 工程规范

> {{kit.generated_from}}
>
> snapshot: \`{{kit.snapshot_id}}\` · template: \`{{kit.template_version}}\` · scoring_config: \`{{kit.scoring_config_version}}\` · obs_date: \`{{kit.obs_date}}\`

## 1. 项目定位

- 目标查询（研究市场原文，不译）：\`{{primary_query}}\`
- 搜索意图：{{search_intent}}
- 核心任务：{{brief_core_job}}
- 交付形态：{{product_shape}}
- 站点策略：{{site_strategy}}
- 判定：{{opportunity.verdict}} · {{opportunity.lifecycle}} · 置信度 {{opportunity.confidence}}（D/M/W = {{opportunity.d_band}}/{{opportunity.m_band}}/{{opportunity.w_band}}）

## 2. MVP 边界

**做什么**

{{mvp_in_scope}}

**不做什么**

{{mvp_out_of_scope}}

## 3. 技术栈约束

| 层 | 选择 |
|---|---|
| 前端 | {{stack_frontend}} |
| 后端 | {{stack_backend}} |
| 数据 | {{stack_database}} |
| 托管 | {{stack_hosting}} |

## 4. SEO 硬要求

- 主页面类型：{{brief_page_type}}
- 核心动作：{{brief_core_action}}
- 必备变体：{{brief_required_variants}}
- 初始页面：{{brief_initial_pages}}
- 内链计划：{{brief_internal_links}}

## 5. 14 天冲刺

{{sprint_plan}}

## 6. 不要做什么

{{brief_non_goals}}

## 7. 叫停红线（命中即止损）

{{kill_rules}}

失效条件：

{{kill_invalidation}}

雷达复查：{{radar_guidance}}

## 8. 叙述

{{narrative_engineering}}

## 9. 交付前自检

{{brief_launch_checklist}}
`
    : `# {{opportunity.title}} — {{kit.archetype}} engineering brief

> {{kit.generated_from}}
>
> snapshot: \`{{kit.snapshot_id}}\` · template: \`{{kit.template_version}}\` · scoring_config: \`{{kit.scoring_config_version}}\` · obs_date: \`{{kit.obs_date}}\`

## 1. Positioning

- Target query (research-market wording, untranslated): \`{{primary_query}}\`
- Search intent: {{search_intent}}
- Core job: {{brief_core_job}}
- Product shape: {{product_shape}}
- Site strategy: {{site_strategy}}
- Decision: {{opportunity.verdict}} · {{opportunity.lifecycle}} · confidence {{opportunity.confidence}} (D/M/W = {{opportunity.d_band}}/{{opportunity.m_band}}/{{opportunity.w_band}})

## 2. MVP boundary

**In scope**

{{mvp_in_scope}}

**Out of scope**

{{mvp_out_of_scope}}

## 3. Stack constraints

| Layer | Choice |
|---|---|
| Frontend | {{stack_frontend}} |
| Backend | {{stack_backend}} |
| Data | {{stack_database}} |
| Hosting | {{stack_hosting}} |

## 4. SEO requirements

- Primary page type: {{brief_page_type}}
- Core action: {{brief_core_action}}
- Required variants: {{brief_required_variants}}
- Initial pages: {{brief_initial_pages}}
- Internal link plan: {{brief_internal_links}}

## 5. The 14-day sprint

{{sprint_plan}}

## 6. What not to build

{{brief_non_goals}}

## 7. Kill criteria

{{kill_rules}}

Invalidation conditions:

{{kill_invalidation}}

Radar watch: {{radar_guidance}}

## 8. Narrative

{{narrative_engineering}}

## 9. Pre-launch checklist

{{brief_launch_checklist}}
`;
  return resolveTemplate(key, template, scope);
}

function renderCursorRules(scope: PlaceholderScope, isZh: boolean): string {
  const key = '.cursorrules';
  // `.cursorrules` 是给 AI 编码助手读的短规则集，与 CLAUDE.md 同源不同形态：
  // 只放"必须遵守 / 禁止"的祈使句，不放叙述与表格。两处都从同一份 scope 取值，
  // 所以不会出现"规范文件说了 A、规则文件说了 B"。
  const template = isZh
    ? `# {{opportunity.title}} — {{kit.archetype}}（snapshot {{kit.snapshot_id}}）

- 只实现 MVP 范围内的功能：{{mvp_in_scope}}
- 明确不做：{{mvp_out_of_scope}}
- 技术栈固定：{{stack_frontend}} / {{stack_backend}} / {{stack_database}} / {{stack_hosting}}
- 主页面类型固定为 {{brief_page_type}}，核心动作是 {{brief_core_action}}
- 目标查询按研究市场原文书写，不翻译：\`{{primary_query}}\`
- 每条路由都要有独立的 \`<title>\`、\`<h1>\` 与 meta description；见 routes.yaml 与 keywords.csv
- 不要因为"更好看"而引入额外依赖、UI 框架或状态管理库
- 不生成营销话术，不编造数据、价格、用户数或排名
- 命中以下任一条件时停下来报告，不要继续加功能：{{kill_rules}}
`
    : `# {{opportunity.title}} — {{kit.archetype}} (snapshot {{kit.snapshot_id}})

- Implement only what is inside the MVP boundary: {{mvp_in_scope}}
- Explicitly do not build: {{mvp_out_of_scope}}
- Fixed stack: {{stack_frontend}} / {{stack_backend}} / {{stack_database}} / {{stack_hosting}}
- Primary page type is {{brief_page_type}}; the core action is {{brief_core_action}}
- Write the target query in the research-market wording; never translate it: \`{{primary_query}}\`
- Every route needs its own \`<title>\`, \`<h1>\` and meta description; see routes.yaml and keywords.csv
- Do not add dependencies, UI frameworks or state libraries for polish alone
- Never invent data, prices, user counts or rankings
- Stop and report if any of these hold instead of adding features: {{kill_rules}}
`;
  return resolveTemplate(key, template, scope);
}

// ---------------------------------------------------------------------------
// ② PSEO 路由与种子词表
// ---------------------------------------------------------------------------

function renderRoutes(
  scope: PlaceholderScope,
  report: OpportunityReportData,
  archetype: BuildArchetype,
  input: AssembleLaunchKitInput,
  isZh: boolean
): string {
  const cluster = [...report.section2.clusterQueries];
  const isPseo = PSEO_ARCHETYPES.includes(archetype);
  const base = `/${slugifyQuery(report.metadata.slug)}`;

  const lines: string[] = [
    `# {{kit.archetype}} routes — {{opportunity.title}}`,
    '# {{kit.generated_from}}',
    `schema_version: '${LAUNCH_KIT_SCHEMA_VERSION}'`,
    `template_version: {{kit.template_version}}`,
    `snapshot_id: {{kit.snapshot_id}}`,
    `scoring_config_version: {{kit.scoring_config_version}}`,
    `observation_date: {{kit.obs_date}}`,
    `research_language: {{kit.research_language}}`,
    `archetype: {{kit.archetype}}`,
    `# ${isZh ? '聚类词一律保留研究市场原文，不翻译、不外推（09 §5.3 硬约束 4）' : 'Cluster terms stay in the research-market wording: never translated, never extrapolated (09 §5.3 constraint 4)'}`,
  ];

  if (isPseo) {
    lines.push('routes:');
    if (cluster.length === 0) {
      lines.push(`  # ${isZh ? '本期报告没有聚类词观测：没有观测就不铺路由' : 'No cluster observation in this report: no observation, no routes'}`);
      lines.push(`  []`);
    } else {
      // 没有词量数据源（04 §2），不按量级排序，只按查询词排：顺序必须确定性可重算。
      const ordered = [...cluster].sort((a, b) => a.query.localeCompare(b.query));
      ordered.forEach((entry, index) => {
        const copy = keywordCopy(report, entry.query);
        lines.push(`  - slug: ${yamlString(`${base}/${slugifyQuery(entry.query)}`)}`);
        lines.push(`    target_keyword: ${yamlString(entry.query)}`);
        lines.push(`    intent: ${entry.intent}`);
        lines.push(`    title: ${yamlString(copy.title)}`);
        lines.push(`    h1: ${yamlString(copy.h1)}`);
        lines.push(`    meta_description: ${yamlString(copy.metaDescription)}`);
        lines.push(`    priority: ${index + 1}`);
        lines.push(`    first_observed: ${yamlString(report.metadata.obsDate)}`);
        // 聚类词一级没有独立的 evidence_id：冻结报告投影里只到快照粒度，所以按
        // 09 §5.3 硬约束 4 的"指回 evidence_id 或 snapshot_id"如实指回快照，
        // 而不是编一个 id 出来。
        lines.push(`    evidence_id: ${yamlString(ABSENT)}`);
        lines.push(`    snapshot_id: ${yamlString(input.snapshotId)}`);
      });
    }
  } else {
    lines.push(`# ${isZh ? '该形态的主体是落地页而不是路由表：路由来自报告的初始页面清单，聚类词作为页面文案的目标词进入 keywords.csv' : 'For this archetype the landing pages are the product; routes come from the report, and cluster terms target on-page copy in keywords.csv'}`);
    lines.push('routes:');
    const pages = report.section5.executionBrief.initialPages;
    if (pages.length === 0) {
      lines.push('  []');
    } else {
      pages.forEach((page, index) => {
        lines.push(`  - path: ${yamlString(page.path)}`);
        lines.push(`    purpose: ${yamlString(page.purpose)}`);
        lines.push(`    priority: ${index + 1}`);
        lines.push(`    target_query: ${yamlString(report.section2.primaryQuery)}`);
        lines.push(`    observed_date: ${yamlString(report.metadata.obsDate)}`);
        lines.push(`    snapshot_id: ${yamlString(input.snapshotId)}`);
      });
    }
  }

  return resolveTemplate('routes.yaml', lines.join('\n') + '\n', scope);
}

/**
 * `title` / `h1` / `meta_description` 由关键词与报告已有字段确定性装配，不经 LLM
 * （09 §5.3 ②）。关键词本身保持研究市场原文。
 */
function keywordCopy(
  report: OpportunityReportData,
  keyword: string
): { title: string; h1: string; metaDescription: string } {
  return {
    title: `${keyword} | ${report.metadata.title}`,
    h1: keyword,
    metaDescription: `${keyword} | ${report.metadata.title}`,
  };
}

function renderKeywordsCsv(report: OpportunityReportData, input: AssembleLaunchKitInput): string {
  const header = [
    'slug',
    'target_keyword',
    'intent',
    'title',
    'h1',
    'meta_description',
    'priority',
    'first_observed',
    'snapshot_id',
    'evidence_id',
  ];
  const base = `/${slugifyQuery(report.metadata.slug)}`;
  const ordered = [...report.section2.clusterQueries].sort((a, b) => a.query.localeCompare(b.query));
  const row = (keyword: string, intent: string, slug: string, priority: number): string => {
    const copy = keywordCopy(report, keyword);
    return [
      slug,
      keyword,
      intent,
      copy.title,
      copy.h1,
      copy.metaDescription,
      String(priority),
      report.metadata.obsDate,
      input.snapshotId,
      ABSENT,
    ]
      .map(csvCell)
      .join(',');
  };
  const rows = ordered.map((entry, index) =>
    row(entry.query, entry.intent, `${base}/${slugifyQuery(entry.query)}`, index + 1)
  );
  // 主词排最前：它是唯一每个形态都有的词，而簇内词只可能在部分机会上有观测。
  const primaryRow = row(report.section2.primaryQuery, report.section2.searchIntent, base, 0);
  return [header.join(','), primaryRow, ...rows].join('\n') + '\n';
}

function renderKeywordsUnavailable(
  report: OpportunityReportData,
  input: AssembleLaunchKitInput,
  isZh: boolean,
  routesOmitted: boolean
): string {
  const omitted = routesOmitted ? 'keywords.csv, routes.yaml' : 'keywords.csv';
  return isZh
    ? `# 词表暂不可用

该机会在簇内尚无基线期后的观测词，所以本点火包不含 ${omitted}：没有观测就不输出，也不外推生成"可能相关的词"（09 §5.3 硬约束 4、第 6 条）。

- 观测起始日：${report.metadata.obsDate}
- 快照：${input.snapshotId}
- 主词（研究市场原文）：${report.section2.primaryQuery}
`
    : `# Keyword list unavailable

No cluster queries have been observed for this opportunity after the baseline period, so this kit omits ${omitted}. Nothing is emitted without an observation, and related terms are never extrapolated (09 §5.3 constraint 4 and item 6).

- Observation start date: ${report.metadata.obsDate}
- Snapshot: ${input.snapshotId}
- Primary query (research-market wording): ${report.section2.primaryQuery}
`;
}

// ---------------------------------------------------------------------------
// ③ 着陆页骨架
// ---------------------------------------------------------------------------

function renderLandingSkeleton(scope: PlaceholderScope, isZh: boolean): string {
  const key = 'landing-skeleton.html';
  // 语言边界（14 §5.4）：这份骨架是**生成资产**，要部署到 {{kit.research_language}}
  // 的市场，所以面向访客的文案一律用研究市场原文；只有给用户的说明性 HTML 注释
  // 跟随 ui_locale。
  const note = isZh
    ? '说明文字跟随界面语言；面向访客的文案必须使用 research_language 原文（14 §5.4）。'
    : 'Explanatory comments follow the UI locale; visitor-facing copy must stay in the research language (14 §5.4).';
  const template = `<!doctype html>
<!-- {{opportunity.title}} — landing skeleton ({{kit.archetype}})
     ${note}
     snapshot: {{kit.snapshot_id}} · template: {{kit.template_version}} · obs_date: {{kit.obs_date}} -->
<html lang="{{kit.research_language}}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{primary_query}}</title>
    <meta name="description" content="{{product_shape}}">
  </head>
  <body>
    <!-- #1 HERO —— 标题必须就是用户的搜索词原文 -->
    <section id="hero">
      <h1>{{primary_query}}</h1>
      <p>{{brief_core_job}}</p>
      <a href="#start" role="button">{{brief_core_action}}</a>
      <!-- TODO(you): 主行动按钮指向真实可用的入口；不要在骨架里留死链 -->
    </section>

    <!-- #2 痛点对比矩阵 —— 行来自 SERP 弱点审计，不自行编造竞品 -->
    <section id="comparison">
      <h2>{{job_to_be_done}}</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Domain</th><th>Result type</th><th>Weak?</th></tr>
        </thead>
        <tbody>
          <!-- 观测到的前十名及其弱点；把本产品的差异点逐行对应到这里 -->
        </tbody>
      </table>
      {{serp_table}}
      <ul>
        {{vulnerability_gaps}}
      </ul>
    </section>

    <!-- #3 商业锚点 —— 只陈列观测到的价格区间与支付方式 -->
    <section id="pricing">
      <h2>Pricing</h2>
      <p>Observed price evidence: {{price_evidence}}</p>
      <p>Observed payment gateways: {{payment_gateways}}</p>
      <!-- TODO(you): 定价档位由你决定。骨架不发明价格——观测到的区间在上，
           要报的价由你填。证据条数：{{evidence_total}}（其中 OBSERVED {{evidence_observed}}） -->
    </section>

    <!-- #4 FAQ —— 覆盖长尾问题，问句用簇内词原文 -->
    <section id="faq">
      <h2>FAQ</h2>
      {{brief_required_variants}}
    </section>

    <!-- #5 CTA -->
    <section id="start">
      <p>{{brief_core_action}}</p>
      <p>{{momentum}}</p>
    </section>
  </body>
</html>
`;
  // 中文档与英文档共用同一份骨架：面向访客的区块按定义就是研究市场的语言，
  // 与界面语言无关，所以没有第二份模板可写。
  return resolveTemplate(key, template, scope);
}

function renderSections(scope: PlaceholderScope, report: OpportunityReportData, isZh: boolean): string {
  const key = 'sections.yaml';
  const sections = [
    { id: 'hero', source: 'section2.primaryQuery + section5.executionBrief.coreJob' },
    { id: 'comparison', source: 'section3.top10Results + section3.vulnerableGaps' },
    { id: 'pricing', source: 'section4.paidCompetitors' },
    { id: 'faq', source: 'section5.executionBrief.requiredVariants' },
    { id: 'start', source: 'section5.executionBrief.coreAction' },
  ];
  const lines = [
    '# {{opportunity.title}} — landing section plan',
    `schema_version: '${LAUNCH_KIT_SCHEMA_VERSION}'`,
    'template_version: {{kit.template_version}}',
    'snapshot_id: {{kit.snapshot_id}}',
    'research_language: {{kit.research_language}}',
    `# ${isZh ? '顺序即带货顺序：先让访客确认「这是我要的」，再证明「现有方案不行」，最后给价格与行动入口。' : 'Order is the persuasion order: confirm intent, prove the incumbents fall short, then price and act.'}`,
    'sections:',
    ...sections.map((section) => `  - id: ${section.id}\n    content_source: ${yamlString(section.source)}`),
    `copy_locale: ${yamlString(report.metadata.locale)}`,
    `unresolved_placeholders: []`,
  ];
  return resolveTemplate(key, lines.join('\n') + '\n', scope);
}
