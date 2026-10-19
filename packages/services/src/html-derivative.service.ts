import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AwsClient } from 'aws4fetch';
import { query } from '@emeradar/db';

/**
 * 原始 HTML 的**派生**清洗（Phase 4）。
 *
 * 只做一件事：给热查询准备一份小得多的版本（去掉 base64 图片、SVG 路径、内联样式），
 * 保留 `<head>` 元信息、支付网关特征节点、以及含价格符号的 DOM 子树。
 *
 * **它不替代原始字节。** 解析规则会变，而清洗流按“当前规则认为有用”剪裁——
 * 被剪掉的部分可能正是下一版需要的（JSON-LD、内联 JS 里的价格、WAF 页面特征）。
 * 所以 raw payload 永远保留，派生只是缓存。
 */
export const DERIVATIVE_VERSION = 'sanitize-v1';
export const MAX_DERIVATIVE_BYTES = 48 * 1024;

const PRICE_HINT = /(?:\$|€|£|USD|EUR|GBP|\bper\s+month\b|\/mo\b|\/month\b|\/yr\b|\/year\b|pricing|billing|checkout|stripe|paddle|lemonsqueezy)/i;

/** 确定性清洗：同一份 HTML 必得同一份派生，便于按 hash 去重。 */
export function sanitizeHtml(html: string): string {
  let out = html
    // 内联 base64 图片通常是页面的绝大部分体积，且与价格无关。
    .replace(/data:[^"')]{64,}/gi, 'data:omitted')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '<svg-omitted/>')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '<style-omitted/>');

  // 保留 <head>（meta/JSON-LD）与命中价格/网关特征的标签块。
  const keepBlocks: string[] = [];
  const head = /<head\b[\s\S]*?<\/head>/i.exec(out);
  if (head) keepBlocks.push(head[0]);

  for (const match of out.matchAll(/<(script|a|div|section|li|span|button|p)\b[^>]*>[\s\S]{0,2000}?<\/\1>/gi)) {
    if (PRICE_HINT.test(match[0])) keepBlocks.push(match[0]);
    if (keepBlocks.join('').length > MAX_DERIVATIVE_BYTES) break;
  }

  out = keepBlocks.join('\n') || out.slice(0, MAX_DERIVATIVE_BYTES);
  return out.slice(0, MAX_DERIVATIVE_BYTES);
}

export interface StoredDerivative {
  storageUrl: string;
  contentHash: string;
  byteSize: number;
}

/** 写派生记录。R2 未配置时只写哈希（无 storage_url），不伪造地址。 */
export async function storeHtmlDerivative(
  rawPayloadId: string,
  html: string,
  kind = 'sanitized_html'
): Promise<StoredDerivative | null> {
  const sanitized = sanitizeHtml(html);
  if (sanitized.trim().length === 0) return null;

  const contentHash = createHash('sha256').update(sanitized).digest('hex');
  const byteSize = Buffer.byteLength(sanitized, 'utf8');

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  let storageUrl: string | null = null;
  if (accountId && accessKeyId && secretAccessKey && bucket) {
    const endpoint = process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
    const key = `derived/${DERIVATIVE_VERSION}/${contentHash}.html.gz`;
    storageUrl = `r2://${bucket}/${key}`;
    try {
      const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
      const res = await client.fetch(`${endpoint}/${bucket}/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/gzip' },
        body: gzipSync(Buffer.from(sanitized, 'utf8')) as any,
      });
      if (!res.ok) storageUrl = null;
    } catch {
      storageUrl = null;
    }
  }

  await query(
    `INSERT INTO raw_payload_derivatives
       (raw_payload_id, kind, derivative_version, storage_url, byte_size, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (raw_payload_id, kind, derivative_version) DO UPDATE SET
       storage_url = COALESCE(EXCLUDED.storage_url, raw_payload_derivatives.storage_url),
       byte_size = EXCLUDED.byte_size,
       content_hash = EXCLUDED.content_hash`,
    [rawPayloadId, kind, DERIVATIVE_VERSION, storageUrl, byteSize, contentHash]
  );

  return { storageUrl: storageUrl ?? '', contentHash, byteSize };
}
