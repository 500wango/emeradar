import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AwsClient } from 'aws4fetch';
import { query } from '@emeradar/db';

/**
 * 原始采集载荷归档（04 §3「载荷」：gzip + sha256，快照可回放）。
 *
 * R2 是 S3 兼容存储；用 aws4fetch 做 SigV4，不引入整套 AWS SDK。
 * 未配置 R2 时返回 null——采集继续，但 `serp_snapshots.raw_payload_id` 保持空，
 * Admin 的「可回放」标记会显示为否；不会伪造 storage_url。
 */
export interface RawPayloadInput {
  collectorRunId: string;
  obsDate: string;
  content: string;
  mimeType: string;
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
  const key = `raw/${input.obsDate}/${contentHash}.json.gz`;
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
    `INSERT INTO raw_payloads (id, collector_run_id, storage_url, content_hash)
     VALUES ($1, $2, $3, $4)`,
    [id, input.collectorRunId, storageUrl, contentHash]
  );
  return { id, storageUrl, contentHash };
}
