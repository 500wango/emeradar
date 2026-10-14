import { lookup } from 'node:dns/promises';
import { EmeradarError, ErrorCode, isPrivateAddress } from '@emeradar/core';

/**
 * 「这个 URL 能不能让我们去 fetch」的唯一定义。
 *
 * 两处调用方（项目站点自检、质押凭证探针）都会把**用户提供的** URL 交给 fetch，
 * 所以两处都必须做同一件事：确认它是公网 http(s)、不带凭据、不带自定义端口，且
 * 解析到的每个地址都不是内网段。这类检查写两遍就会漂移，而漂移的那一份等于一个
 * SSRF 入口——攻击者只需要找到那个漏掉 DNS 复查的实现。
 *
 * 只做 DNS 解析层面的拦截，不做重定向跟随：跟随时每一跳都必须重新过这里，这由
 * 调用方在循环里保证（见 `ProjectService.inspectProjectSite`）。
 *
 * `lookupImpl` 是为了让这道闸本身可被测试。它拦的两种情形——解析到内网地址、
 * 压根解析不出地址——都没法靠真实 DNS 按需制造：改 hosts、拔网线都不是测试能依赖
 * 的手段。而"拦截分支有没有被覆盖"恰恰是安全代码最要紧的那一问，所以解析器从外面
 * 给。生产路径永远走默认值。
 */
export async function assertPublicHttpUrl(
  raw: string,
  options: { lookupImpl?: typeof lookup } = {}
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'Target URL must be a valid URL.', 400);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'Target URL must be a public HTTP(S) URL.', 400);
  }
  const resolve = options.lookupImpl ?? lookup;
  const addresses = await resolve(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new EmeradarError(ErrorCode.VALIDATION_ERROR, 'Target URL must resolve to a public address.', 400);
  }
  return url;
}
