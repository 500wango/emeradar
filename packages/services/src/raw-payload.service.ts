import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AwsClient } from 'aws4fetch';
import { query } from '@emeradar/db';

/**
 * 原始采集载荷归档（04 §3：gzip + sha256，快照可回放）。
 *
 * Phase 0 起补齐重放所需的全部事实：
 *   - `provider` / `sourceId`：这次是谁给的（DataForSEO ≠ SerpAPI ≠ Brave）；
 *   - `requestParams`：query、location_code、language_code、depth；
 *   - `httpStatus` / `locale` / `fetchedAt`：什么时候、以什么状态拿到的。
 *
 * 没有这些字段，“可重算”只是口号：同一份归一化行无法区分是谁、用什么参数算出来的。
 *
 * R2 未配置时返回 null，调用方继续，但 `raw_payload_id` 为空——不伪造 storage_url。
 */
export interface RawPayloadInput {
  collectorRunId: string;
  sourceId: string;
  provider: string;
  obsDate: string;
  content: string;
  mimeType: string;
  requestParams?: Record<string, unknown>;
  httpStatus?: number | null;
  locale?: string | null;
  fetchedAt?: Date;
}

export interface StoredRawPayload {
  id: string;
  storageUrl: string;
  contentHash: string;
}

let missingConfigWarned = false;

export async function storeRawPayload(input: RawPayloadInput): Promise<StoredRawPayload | null> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    if (!missingConfigWarned) {
      console.warn('[raw-payload] R2 is not configured; raw payloads will not be archived.');
      missingConfigWarned = true;
    }
    return null;
  }

  const contentHash = createHash('sha256').update(input.content).digest('hex');

  // 内容寻址去重（CAS）：同一份内容只上传一次。昨天和今天的 Autocomplete JSON
  // 有很高概率完全一样，竞品定价 DOM 连续多天不变——重复上传只是在为同一份字节付钱。
  const existing = await query<{ id: string; storage_url: string }>(
    `SELECT id::text, storage_url FROM raw_payloads
      WHERE content_hash = $1 AND source_id = $2
      ORDER BY fetched_at DESC LIMIT 1`,
    [contentHash, input.sourceId]
  );
  if (existing.rows[0]) {
    const id = randomUUID();
    // 仍然写一行记录：时序指针必须存在，否则“那天采集过”无法回答。
    await query(
      `INSERT INTO raw_payloads
         (id, collector_run_id, source_id, provider, storage_url, content_hash,
          request_params, http_status, locale, fetched_at, mime_type, byte_size)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12`,
      [
        id,
        input.collectorRunId,
        input.sourceId,
        input.provider,
        existing.rows[0].storage_url,
        contentHash,
        JSON.stringify(input.requestParams ?? {}),
        input.httpStatus ?? null,
        input.locale ?? null,
        input.fetchedAt ?? new Date(),
        input.mimeType,
        Buffer.byteLength(input.content, 'utf8'),
      ]
    );
    return { id, storageUrl: existing.rows[0].storage_url, contentHash };
  }

  const extension = input.mimeType.includes('html') ? 'html' : 'json';
  const key = `raw/${input.obsDate}/${contentHash}.${extension}.gz`;
  const endpoint = process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
  const storageUrl = `r2://${bucket}/${key}`;
  const body = gzipSync(Buffer.from(input.content, 'utf8'));

  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  const res = await client.fetch(`${endpoint}/${bucket}/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/gzip' },
    body: body as any,
  });
  if (!res.ok) {
    throw new Error(`R2 upload failed: HTTP ${res.status}`);
  }

  const id = randomUUID();
  await query(
    `INSERT INTO raw_payloads
       (id, collector_run_id, source_id, provider, storage_url, content_hash,
        request_params, http_status, locale, fetched_at, mime_type, byte_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      input.collectorRunId,
      input.sourceId,
      input.provider,
      storageUrl,
      contentHash,
      JSON.stringify(input.requestParams ?? {}),
      input.httpStatus ?? null,
      input.locale ?? null,
      input.fetchedAt ?? new Date(),
      input.mimeType,
      Buffer.byteLength(input.content, 'utf8'),
    ]
  );
  return { id, storageUrl, contentHash };
}
