/**
 * 上线凭证的归一化主机名（02 §5、03 §12 `project_credentials.host`）。
 *
 * 这个字符串的唯一用途是**当 SERP 匹配的键**：采集回来的 Top 100 结果里每一条都带
 * 一个域名，拿它去比对已核验项目的 `host`，命中即说明这个项目真的进了榜（PRD F10）。
 * 所以两条写路径（GO 时提交凭证、7 天窗口内补交凭证）必须算出**同一个**字符串，
 * 否则同一个页面在两个入口下会被算成两个不同的项目。
 *
 * 归一化规则刻意只有三条：小写、去掉前导 `www.`、去掉末尾的点。
 *   - 前两条对齐 `serp-collector` 的 `extractDomain`（SERP 结果侧就是这么归一的），
 *     键的两端必须用同一把尺子。
 *   - 不去 eTLD+1、不合并子域：`app.example.com` 与 `example.com` 是两个站点，
 *     把前者折成后者会让一个第三方子域替别人领走排名。
 *
 * 解析失败返回 null，而不是抛错：调用方拿 null 就是"这个项目不被追踪"，而抛错会让
 * 一次已经成立的 GO 因为一个拼错的 URL 失败——凭证探针早就在更前面拒掉真正的坏 URL
 * （`assertPublicHttpUrl`），这里只是不替它做第二次判断。
 */
export function normalizeCredentialHost(value: string): string | null {
  try {
    return normalizeHostname(new URL(value).hostname);
  } catch {
    return null;
  }
}

/**
 * 归一化一个**主机名**（不是 URL）。
 *
 * 与 `normalizeCredentialHost` 分开，是因为匹配的两侧来源不同：凭证侧存的是从 URL
 * 解析出来的主机名，SERP 侧拿回来的也是主机名。比对时必须用**同一个**函数，否则
 * 一把尺子量出两种结果——`example.com.`（尾部有点，0006 的回填就留下过这种）会与
 * `example.com` 不相等，而那表现为"追踪突然什么都没匹配到"，不是报错。
 */
export function normalizeHostname(hostname: string): string | null {
  const stripped = hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return stripped.length > 0 ? stripped : null;
}
