/**
 * 「谁还占着这个机会的槽位」的唯一定义（03 §8 的 D2）。
 *
 * 这个判定原先散落在五处，而且**各处写法不一致**：立项门槛用 `status != 'ARCHIVED'`，
 * 而三处展示与一处评分用 `status != 'ABANDONED'`。后者根本不是 `projects.status`
 * 的合法取值（CHECK 只有 IN_DEVELOPMENT/LAUNCHED/ARCHIVED），于是那个条件恒为真——
 * 归档的项目照样被算作占用。后果是用户看到"槽位已满"而实际并没有满，且熔断会把
 * 机会压成 WINDOW_CLOSING，连带影响公开投影与告警。
 *
 * 收敛成一处不够：真正让这类漂移不可能再发生的是"只有一个定义点"。P1 落地槽位表后，
 * 这个函数会改为解析 `slot_claims.state = 'CLAIMED'`（那才是 D2 的最终形态），届时
 * 只有这一个文件需要改。
 */

/**
 * 生成"该项目仍占用槽位"的 SQL 谓词。
 * `alias` 是调用方自己的表别名（代码常量，不接受外部输入）。
 */
export function activeClaimPredicate(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}status <> 'ARCHIVED'`;
}
