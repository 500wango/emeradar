/**
 * 04 §6.1 的成本公式，写成纯函数以便做回归测试（31 T2.5，18 §4.2）。
 *
 * 单价 `c_*` 是**输入**，不是常量：真实报价与实测占比要由 Gate 0 填入。这里刻意不带
 * 任何默认单价——写一个看起来合理的默认值，等于把没测过的数字放进成本表。
 */
export interface CostInputs {
  /** A 层 / B 层追踪的机会（query）数。 */
  nA: number;
  nB: number;
  /** A / B 层每次采集的页数（10 条一页）；默认 1。 */
  pA?: number;
  pB?: number;
  /** 映射到已核验 Project 的 query 数（每周补齐到 Top 100）。 */
  nProjQ: number;
  /** 自动补全每日请求数（由早停规则动态产生）、单价。 */
  nAc: number;
  cAc: number;
  /** 被爬取的域名数、单价、爬取间隔天数；无头浏览器占比与单价。 */
  nDom: number;
  cCrawl: number;
  fCrawl: number;
  rHeadless: number;
  cHeadless: number;
  /** 注意力源、LLM、词量（按月）日均成本。 */
  cAttn: number;
  cLlm: number;
  cVolMonth: number;
  /** 每页（10 条）SERP 单价。 */
  cPage: number;
}

export function slowLaneDailyCost(i: CostInputs): number {
  const pA = i.pA ?? 1;
  const pB = i.pB ?? 1;
  return (
    i.nA * pA * i.cPage +
    (i.nB / 7) * pB * i.cPage +
    // 已核验项目的 query 每周补齐 Top 100：再取 (10 − pA) 页，不是再取 1 个 Top 100 请求。
    (i.nProjQ / 7) * (10 - pA) * i.cPage +
    i.nAc * i.cAc +
    (i.nDom * i.cCrawl) / i.fCrawl +
    (i.nDom * i.rHeadless * i.cHeadless) / i.fCrawl +
    i.cAttn +
    i.cLlm +
    i.cVolMonth / 30
  );
}

export interface FastLaneInputs {
  uActive: number;
  sPerUser: number;
  rDedup: number;
  cScan: number;
}

export function fastLaneMonthlyCost(i: FastLaneInputs): number {
  return i.uActive * i.sPerUser * (1 - i.rDedup) * i.cScan;
}

export function grossMargin(monthlyRevenue: number, slowMonthly: number, fastMonthly: number, fixed: number): number {
  return 1 - (slowMonthly + fastMonthly + fixed) / monthlyRevenue;
}
