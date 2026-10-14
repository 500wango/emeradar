import { lookup } from 'node:dns/promises';
import { query, transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode, readBodyWithLimit } from '@emeradar/core';
import { assertPublicHttpUrl } from './public-url';
import { normalizeCredentialHost } from './credential-host';
import { SlotService } from './slot.service';
import { STAKE_WINDOW_DAYS } from './project.service';

/**
 * 承诺质押（PRD F10、01 §1.7 第 5 条、09 §8、19 Epic 1.13）。
 *
 * 认领槽位是"我要做"，质押是"我真的做了"。没有后者，占坑没有任何成本，槽位会在
 * 几天内被不打算动手的人占满——而那正是这套机制要防的。
 *
 * 两条不可动摇的规则：
 *   - 逾期释放**槽位**，但**不退还**已扣的配额（PRD §1.7 第 5 条）。退还等于把
 *     "每月 5 次"变成无限次：占了坑、不做事、拿回额度、再占一次。
 *   - 校验用的是**探针实际取回的内容**，不是用户填的字段。页面不可达、或通篇与
 *     机会主词无关，都不算"上线了"。
 */

export type CredentialType = 'DOMAIN_URL' | 'STORE_LISTING_URL' | 'PUBLIC_PAGE_URL';

export const CREDENTIAL_TYPES: readonly CredentialType[] = [
  'DOMAIN_URL',
  'STORE_LISTING_URL',
  'PUBLIC_PAGE_URL',
];

export function isCredentialType(value: string): value is CredentialType {
  return (CREDENTIAL_TYPES as readonly string[]).includes(value);
}

/** 探针取回的关键字段，原样落进 `project_credentials.probe` 供用户自查。 */
export interface CredentialProbe {
  ok: boolean;
  httpStatus: number | null;
  finalUrl: string | null;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  /** 命中词数 / 总词数，0–1。落库是为了让"为什么判它相关"可被复查。 */
  relevance: number;
  matchedTerms: string[];
  /** 拒绝理由（人可读，中文）；通过时为 null。 */
  reason: string | null;
}

/**
 * 占位页特征。判据必须落在**取回的内容**上：一个还没有内容的域名首页往往返回
 * 200，只靠状态码会把"占了个域名"当成"上线了"。
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /coming\s+soon/i,
  /under\s+construction/i,
  /site\s+is\s+temporarily\s+unavailable/i,
  /just\s+a\s+moment/i,
  /checking\s+your\s+browser/i,
  /index\s+of\s*\//i,
  /default\s+web\s+site\s+page/i,
  /welcome\s+to\s+nginx/i,
  /apache2?\s+ubuntu\s+default\s+page/i,
  /buy\s+this\s+domain/i,
  /domain\s+is\s+for\s+sale/i,
];

/**
 * 相关性判据：主词与簇内词中，**命中数 ≥ ⌈词数 / 2⌉ 且至少 1 个**。
 *
 * 取一半而不是"必须全中"，是因为簇内词是候选长尾，一个只做了主词的页面同样是
 * 真实上线；取一半而不是"命中任一"，是因为只做一个宽泛词（比如只出现 "pdf"）
 * 的页面可以是任何东西，那样这条规则就退化成不做校验。
 */
export function evaluateRelevance(terms: readonly string[], haystack: string): { matched: string[]; relevance: number } {
  const normalizedHaystack = normalizeForMatch(haystack);
  const unique = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  const matched = unique.filter((term) => normalizedHaystack.includes(normalizeForMatch(term)));
  return { matched, relevance: unique.length === 0 ? 0 : matched.length / unique.length };
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function extractFirst(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match?.[1] ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

/**
 * 取回页面并抽取判定所需的关键字段。
 *
 * `fetchImpl` 可注入，因为这条路径的全部风险都在网络边界上（不可达、超时、占位页、
 * 内网重定向），而这些都是必须被测试的分支——不能等到线上才发现。
 */
export async function probeCredential(input: {
  url: string;
  credentialType: CredentialType;
  terms: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 解析器注入口，理由见 `assertPublicHttpUrl`。生产路径不传。 */
  lookupImpl?: typeof lookup;
}): Promise<CredentialProbe> {
  const doFetch = input.fetchImpl ?? fetch;
  const timeout = input.timeoutMs ?? 6000;
  const resolve = { lookupImpl: input.lookupImpl };
  let current = await assertPublicHttpUrl(input.url, resolve);
  let response: Response | null = null;

  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await doFetch(current, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'EmeradarBot/1.0 (+https://emeradar.com/bot)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location || redirects === 3) {
      return rejection('Site redirects exceed the safety limit.', response.status, current.toString());
    }
    // 每一跳都重新过公网校验：一个公网域名可以把 Location 指向 169.254.169.254。
    current = await assertPublicHttpUrl(new URL(location, current).toString(), resolve);
  }

  const finalUrl = current.toString();
  if (!response || !response.ok) {
    return rejection(
      `The submitted page did not load (HTTP ${response?.status ?? 'no response'}).`,
      response?.status ?? null,
      finalUrl
    );
  }

  const html = await readBodyWithLimit(response);
  const title = extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = extractFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const metaDescription = extractFirst(
    html,
    /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i
  );

  const base = {
    httpStatus: response.status,
    finalUrl,
    title,
    h1,
    metaDescription,
  };

  const placeholderMatch = PLACEHOLDER_PATTERNS.find((pattern) => pattern.test(title || '') || pattern.test(html.slice(0, 4000)));
  if (placeholderMatch) {
    return { ...base, ok: false, relevance: 0, matchedTerms: [], reason: 'The page is a placeholder or parking page, not a launched product.' };
  }

  const haystack = [title, h1, metaDescription].filter(Boolean).join(' \n ');
  const { matched, relevance } = evaluateRelevance(input.terms, haystack);
  const threshold = Math.max(1, Math.ceil(new Set(input.terms.filter((t) => t.trim())).size / 2));
  if (matched.length < threshold) {
    return {
      ...base,
      ok: false,
      relevance,
      matchedTerms: matched,
      reason: `The page's title/description do not mention this opportunity's topic (matched ${matched.length} of the required ${threshold}).`,
    };
  }

  return { ...base, ok: true, relevance, matchedTerms: matched, reason: null };
}

function rejection(reason: string, httpStatus: number | null, finalUrl: string | null): CredentialProbe {
  return { ok: false, httpStatus, finalUrl, title: null, h1: null, metaDescription: null, relevance: 0, matchedTerms: [], reason };
}

export interface StakeStatusView {
  projectId: string;
  stakeStatus: string;
  stakeDeadlineAt: string;
  outcomeStatus: string;
  credentials: Array<{
    id: string;
    credentialType: string;
    url: string;
    verificationState: string;
    rejectionReason: string | null;
    checkedAt: string | null;
  }>;
}

export class StakeService {
  /** 该项目所属机会的主词与簇内词——相关性的判定依据。 */
  private static async opportunityTerms(projectId: string): Promise<string[]> {
    const res = await query<{ term: string }>(
      `SELECT COALESCE(q.query_text, c.primary_query) AS term
         FROM projects p
         JOIN opportunity_cards c ON c.opportunity_id = p.opportunity_id
         LEFT JOIN opportunity_queries oq ON oq.opportunity_id = p.opportunity_id
         LEFT JOIN queries q ON q.id = oq.query_id
        WHERE p.id = $1 AND COALESCE(q.query_text, c.primary_query) IS NOT NULL`,
      [projectId]
    );
    return res.rows.map((row) => row.term);
  }

  static async getStakeStatus(projectId: string, userId: string): Promise<StakeStatusView> {
    const project = await query<{
      stake_status: string; stake_deadline_at: Date; outcome_status: string; user_id: string;
    }>(
      `SELECT stake_status, stake_deadline_at, outcome_status, user_id FROM projects WHERE id = $1`,
      [projectId]
    );
    const row = project.rows[0];
    if (!row || row.user_id !== userId) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    }
    const creds = await query<any>(
      `SELECT id, credential_type, url, verification_state, rejection_reason, checked_at
         FROM project_credentials WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );
    return {
      projectId,
      stakeStatus: row.stake_status,
      stakeDeadlineAt: row.stake_deadline_at.toISOString(),
      outcomeStatus: row.outcome_status,
      credentials: creds.rows.map((c) => ({
        id: c.id,
        credentialType: c.credential_type,
        url: c.url,
        verificationState: c.verification_state,
        rejectionReason: c.rejection_reason,
        checkedAt: c.checked_at ? new Date(c.checked_at).toISOString() : null,
      })),
    };
  }

  /**
   * 提交一份上线凭证并当场探针校验（09 §8、10 §4.5）。
   *
   * 校验**失败不释放槽位**：用户还有到 `stake_deadline_at` 为止的时间去改页面或换
   * 凭证。只有到期仍未通过才释放。把一次失败的尝试直接等同于逾期，会让"填错了一次
   * URL"付出槽位的代价。
   */
  static async submitCredential(
    projectId: string,
    userId: string,
    input: { credentialType: string; url: string },
    options: { fetchImpl?: typeof fetch; lookupImpl?: typeof lookup } = {}
  ): Promise<{ verified: boolean; probe: CredentialProbe }> {
    if (!isCredentialType(input.credentialType)) {
      throw new EmeradarError(
        ErrorCode.VALIDATION_ERROR,
        `credential_type must be one of ${CREDENTIAL_TYPES.join(', ')}.`,
        400
      );
    }
    const project = await query<{ user_id: string; stake_status: string; stake_deadline_at: Date }>(
      `SELECT user_id, stake_status, stake_deadline_at FROM projects WHERE id = $1`,
      [projectId]
    );
    const row = project.rows[0];
    if (!row || row.user_id !== userId) {
      throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
    }
    if (row.stake_status === 'EXPIRED_RELEASED') {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'This project\'s stake window has already expired and its slot was released.',
        422
      );
    }
    if (row.stake_status === 'VERIFIED') {
      throw new EmeradarError(ErrorCode.CONFLICT, 'This project already has a verified credential.', 409);
    }
    if (row.stake_deadline_at.getTime() < Date.now()) {
      throw new EmeradarError(
        ErrorCode.PRECONDITION_FAILED,
        'The stake window has passed. The slot is released at the next expiry sweep.',
        422
      );
    }

    const terms = await StakeService.opportunityTerms(projectId);
    const probe = await probeCredential({
      url: input.url,
      credentialType: input.credentialType,
      terms,
      fetchImpl: options.fetchImpl,
      lookupImpl: options.lookupImpl,
    });

    const credentialId = `crd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await query(
      `INSERT INTO project_credentials
         (id, project_id, credential_type, url, host, verification_state, probe, checked_at, rejection_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), $8)`,
      [
        credentialId,
        projectId,
        input.credentialType,
        probe.finalUrl ?? input.url,
        normalizeCredentialHost(probe.finalUrl ?? input.url),
        probe.ok ? 'VERIFIED' : 'REJECTED',
        JSON.stringify({
          ok: probe.ok,
          httpStatus: probe.httpStatus,
          title: probe.title,
          h1: probe.h1,
          metaDescription: probe.metaDescription,
          relevance: probe.relevance,
          matchedTerms: probe.matchedTerms,
        }),
        probe.reason,
      ]
    );

    if (!probe.ok) {
      throw new EmeradarError(
        ErrorCode.CREDENTIAL_UNVERIFIED,
        probe.reason ?? 'The submitted credential could not be verified.',
        422,
        { details: { probe } }
      );
    }

    await query(`UPDATE projects SET stake_status = 'VERIFIED', updated_at = NOW() WHERE id = $1`, [projectId]);
    return { verified: true, probe };
  }

  /**
   * 每日逾期待办（02 §131、不变量 I12）。
   *
   * 扫出 `stake_status = 'PENDING'` 且已过期的项目，终结质押并释放槽位。
   * **不碰 `usage_counters`**：逾期释放不退配额是设计的一半（PRD §1.7 第 5 条）。
   *
   * 返回受影响的项目，供调用方写审计与发通知。逐行在一个事务里处理：一条记录失败
   * 不该让整批回滚，否则一个坏行会让所有逾期项目都不再被释放。
   */
  static async releaseExpiredStakes(now: Date = new Date()): Promise<Array<{ projectId: string; userId: string; opportunityId: string | null }>> {
    const expired = await query<{ id: string; user_id: string; opportunity_id: string | null }>(
      `SELECT id, user_id, opportunity_id FROM projects
        WHERE stake_status = 'PENDING' AND stake_deadline_at < $1`,
      [now]
    );

    const released: Array<{ projectId: string; userId: string; opportunityId: string | null }> = [];
    for (const row of expired.rows) {
      const ok = await transaction(async (client) => {
        // 条件更新兜住并发：如果用户恰在此刻提交了凭证，这里就应当什么都不做。
        const claimed = await client.query(
          `UPDATE projects SET stake_status = 'EXPIRED_RELEASED', updated_at = NOW()
            WHERE id = $1 AND stake_status = 'PENDING'
            RETURNING id`,
          [row.id]
        );
        if (claimed.rows.length === 0) return false;
        // 走 SlotService.release 而不是在这里再写一遍递减：那是槽位汇总缓存唯一的
        // 写入点，第二次实现迟早会漏掉幂等判断，把别人的占用从缓存里减掉。
        const slot = await client.query<{ id: string }>(
          `SELECT id FROM slot_claims WHERE project_id = $1 AND state = 'CLAIMED'`,
          [row.id]
        );
        for (const claim of slot.rows) {
          await SlotService.release(client, { slotClaimId: claim.id, state: 'EXPIRED', reason: 'STAKE_EXPIRED' });
        }
        return true;
      });
      if (ok) released.push({ projectId: row.id, userId: row.user_id, opportunityId: row.opportunity_id });
    }
    return released;
  }

  /** 质押窗口的截止时间，供 GO 在建项目时一并写入。 */
  static deadlineFrom(start: Date, days: number = STAKE_WINDOW_DAYS): Date {
    return new Date(start.getTime() + days * 86_400_000);
  }
}
