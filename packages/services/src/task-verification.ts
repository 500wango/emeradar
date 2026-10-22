/**
 * 任务价值准入 Gate（审计 01，P0）。
 *
 * 审计结论：`generate-discovery-intents` 按标题机械拼出 "… tool / … alternative"，
 * `validate-discovery-intents` 只要 Autocomplete 或 SERP 任一非空就把 intent 晋级为
 * OBSERVED，实验卡随即把这条**检索证据**当成用户任务。技术新闻标题、导航型查询
 * 就这样变成"看起来可执行却无用户痛点"的实验卡。
 *
 * 本模块给出确定性的三档结论（版本化，便于回溯口径）：
 *   - TASK_VERIFIED：工具形状的查询 + 至少一条**独立**需求信号
 *     （UGC/QA 讨论、目录收录、确证满足查询的专属供给、任务型联想词）；
 *   - TASK_UNVERIFIED：检索证据存在，但没有任何独立需求信号——只能停在观察；
 *   - TASK_REFUTED：新闻/事件型标题或裸导航词——检索证据再充分也不是用户任务。
 *
 * 这是启发式代理判据，不是「目标用户/任务/输入输出」的完整审查；它的职责是
 * 让无任务价值的条目**进不了实验推荐**，剩余的判断留给人工与后续模型审查。
 */

export const TASK_VERIFICATION_VERSION = 'task-verification-v1';

export type TaskStatus = 'TASK_VERIFIED' | 'TASK_UNVERIFIED' | 'TASK_REFUTED';

export interface TaskVerificationInput {
  /** 来源条目标题（新闻标题、Show HN 等）。 */
  sourceTitle?: string;
  queryHypothesis: string;
  serpItems?: Array<{
    resultType?: string;
    title?: string;
    queryRelevance?: string;
  }>;
  autocompleteSuggestions?: string[];
}

export interface TaskVerificationResult {
  taskStatus: TaskStatus;
  /** 判据 hit 列表，随 task_evidence 落库，审计可回放。 */
  reasons: string[];
  /** 独立需求信号（VERIFIED 的依据）。 */
  signals: string[];
  version: string;
  /** assessTaskVerification 的 evidence 载荷（discovery_validations.task_evidence）。 */
  evidence: {
    version: string;
    taskStatus: TaskStatus;
    newsLike: boolean;
    navigational: boolean;
    signals: string[];
    reasons: string[];
  };
}

/** 新闻/事件型语式：日期+活动、票务、公告、赛况、融资司法等。 */
const NEWS_LIKE: RegExp[] = [
  /\b(20\d{2})\b[^.]{0,40}\b(tour|schedule|tickets?|dates|lineup|season|premiere|trailer|festival|election|olympics|world cup)\b/i,
  /\b(tour|concert|match|game|series|season|film|movie|election|trailer)\b[^.]{0,40}\b(20\d{2}|schedule|tickets?|dates|score|standings|results?)\b/i,
  /\b(breaking|announced?|launch(?:es|ed)? date|box office|ipo|earnings report|funding round|series [a-c] round|layoffs|lawsuit|sentenced|indict\w+|acquisition of)\b/i,
];

/** 工具/软件形状的查询（机械生成会追加 "tool"，所以只作参考不作门槛）。 */
const TOOL_SHAPE =
  /\b(tool|app|api|generator|calculator|converter|checker|template|maker|builder|tracker|planner|finder|remover|extractor|summarizer|editor|dashboard|software|extension|plugin|automation|validator|formatter)\b/i;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/** UGC/讨论标题是否真的在讨论这个查询的主题（≥1 个实义词重叠）。 */
function discussesQuery(queryHypothesis: string, title: string | undefined): boolean {
  if (!title) return false;
  const queryTokens = new Set(tokenize(queryHypothesis));
  const titleTokens = tokenize(title);
  return titleTokens.some((t) => queryTokens.has(t));
}

export function assessTaskVerification(input: TaskVerificationInput): TaskVerificationResult {
  const text = `${input.sourceTitle ?? ''} ${input.queryHypothesis}`;
  const reasons: string[] = [];
  const signals: string[] = [];

  // 1. 导航词：单词（或等价裸品牌）没有可服务的任务。
  const wordCount = input.queryHypothesis.trim().split(/\s+/).filter(Boolean).length;
  const navigational = wordCount < 2;
  if (navigational) reasons.push('navigational_bare_query');

  // 2. 新闻/事件型：来源标题或查询本体命中新闻语式。
  const newsLike = NEWS_LIKE.some((pattern) => pattern.test(text));
  if (newsLike) reasons.push('news_or_event_headline');

  // 3. 独立需求信号：至少一条来自 SERP 内容或联想词的**行为**证据。
  for (const item of input.serpItems ?? []) {
    if ((item.resultType === 'UGC_THREAD' || item.resultType === 'QA') && discussesQuery(input.queryHypothesis, item.title)) {
      signals.push('ugc_discussion');
    } else if (item.resultType === 'DIRECTORY') {
      signals.push('directory_listing');
    } else if (item.resultType === 'SPECIALIST' && item.queryRelevance === 'SATISFIES') {
      signals.push('satisfying_specialist_supply');
    }
  }
  const otherSuggestions = (input.autocompleteSuggestions ?? []).filter(
    (s) => s.trim().toLowerCase() !== input.queryHypothesis.trim().toLowerCase()
  );
  if (
    otherSuggestions.some((s) => TOOL_SHAPE.test(s) && !TOOL_SHAPE.test(input.queryHypothesis)) ||
    otherSuggestions.length >= 2
  ) {
    signals.push('autocomplete_task_demand');
  }

  let taskStatus: TaskStatus;
  if (newsLike || navigational) {
    taskStatus = 'TASK_REFUTED';
  } else if (signals.length >= 1) {
    taskStatus = 'TASK_VERIFIED';
    reasons.push(`independent_demand_signal:${signals.join('+')}`);
  } else {
    taskStatus = 'TASK_UNVERIFIED';
    reasons.push('retrieval_evidence_only_no_demand_signal');
  }

  return {
    taskStatus,
    reasons,
    signals: [...new Set(signals)],
    version: TASK_VERIFICATION_VERSION,
    evidence: {
      version: TASK_VERIFICATION_VERSION,
      taskStatus,
      newsLike,
      navigational,
      signals: [...new Set(signals)],
      reasons,
    },
  };
}
