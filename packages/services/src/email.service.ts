/**
 * 交易类邮件的唯一发送器。
 *
 * 这里原本有两份逐字相同的实现（`apps/web/src/lib/email-delivery.ts` 与
 * `pipeline.ts` 里的 `deliverAlertEmail`）。两份的差别只有返回值：一份吞掉失败，
 * 一份连失败都不报。到宽限期催缴要发第三封时，就该收敛了 —— 邮件"发没发出去"
 * 是个必须能回答的问题，而三份各自处理的答案不会一致。
 *
 * 传输通道按顺序选择：**SMTP 优先**（自建 Stalwart，或任何 SMTP 服务商），
 * 其次 Resend 的 HTTP API。两者都没有可用的收件人之外的配置就返回 `false`：
 * 本地与测试环境没配这两个通道是常态，缺配置不该让调用方的业务流程失败。
 * 但调用方必须**看得见**这个 `false`，不能当成功。`emailTransport()` 就是用来
 * 回答"这条部署现在到底走哪条通道"的。
 *
 * 两条通道的去重语义不同，别当成一回事：
 * - Resend 认 `Idempotency-Key`，重复请求由服务商去重。
 * - SMTP 没有这个能力。退一步：由 `idempotencyKey` 派生一个**确定的 Message-ID**，
 *   Gmail 这类收件方会静默丢弃 Message-ID 完全相同的重复邮件 —— 但那是收件方
 *   行为，不是协议保证。真正"一天只发一封"的依据仍是调用方的规则与日期
 *   （见 pipeline.ts 的 `alert/<rule>/<date>`），不是这里。
 */
import { createHash } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
}

/** 当前部署实际会用的通道；`none` 表示邮件只会返回 false 并写日志。 */
export type EmailTransport = 'smtp' | 'resend' | 'none';

export function emailTransport(): EmailTransport {
  if (process.env.SMTP_HOST?.trim()) return 'smtp';
  if (process.env.RESEND_API_KEY?.trim()) return 'resend';
  return 'none';
}

export async function sendTransactionalEmail(input: TransactionalEmail): Promise<boolean> {
  // `MAIL_FROM` 是通用名字；`ALERT_FROM_EMAIL` 是历史遗留，仍然是它就能继续用。
  const from = (process.env.MAIL_FROM || process.env.ALERT_FROM_EMAIL || '').trim();
  if (!from || !input.to) return false;

  const smtp = smtpSettings();
  if (smtp) return sendViaSmtp(smtp, from, input);

  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return false;
  return sendViaResend(key, from, input);
}

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}

/** 未配置 `SMTP_HOST` 时返回 null —— 通道的开关只有一个变量，不靠猜端口。 */
function smtpSettings(): SmtpSettings | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  if (!Number.isInteger(port) || port <= 0) return null;
  // 465 是隐式 TLS（连上就握手，没有明文问候），587 是 STARTTLS。默认值跟端口
  // 走，是因为"端口定了加密方式"已经是 SMTP 的既有约定，让配置少一个能填反的项。
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
  return {
    host,
    port,
    secure,
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASSWORD || undefined,
  };
}

let cached: { key: string; transporter: Transporter } | null = null;

function getTransporter(s: SmtpSettings): Transporter {
  const key = JSON.stringify([s.host, s.port, s.secure, s.user, s.pass]);
  if (cached?.key === key) return cached.transporter;
  // 不用连接池：单封发信自己开自己关，没有需要回收的长连接，也就不必在换配置时
  // 去"关闭旧实例"（nodemailer 的 Mail 对象在非池模式下没有这个动作）。
  const transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    // 带凭据的连接必须加密：465 是隐式 TLS，其余端口强制 STARTTLS，宁可直接失败
    // 也不把密码发到明文通道里。没有认证信息时（本地假服务器、内网中继）不要求。
    requireTLS: Boolean(s.user) && !s.secure,
    // 与 Resend 通道一样有界：连接、问候、读写各自超时，不允许无限等待把
    // HTTP 请求或队列任务挂死。
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  cached = { key, transporter };
  return transporter;
}

async function sendViaSmtp(s: SmtpSettings, from: string, input: TransactionalEmail): Promise<boolean> {
  try {
    const info = await getTransporter(s).sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.idempotencyKey ? { messageId: deterministicMessageId(input.idempotencyKey, from) } : {}),
    });
    const accepted = info.accepted ?? [];
    const rejected = (info.rejected ?? []).map(String);
    // "服务器收下了" 才叫成功。一个收件人都没收下（对方 5xx 拒收）时返回 false，
    // 而不是看着 sendMail 没抛错就报成功。
    if (accepted.length === 0) {
      console.error(
        `[email] SMTP rejected every recipient for ${input.to}: ${rejected.join(', ') || 'no accepted recipients'}`
      );
      return false;
    }
    if (rejected.length > 0) {
      console.error(`[email] SMTP rejected part of the recipients: ${rejected.join(', ')}`);
    }
    return true;
  } catch (error) {
    console.error(`[email] Sending to ${input.to} via ${s.host}:${s.port} failed:`, error);
    return false;
  }
}

/** 同一个 idempotencyKey 永远映射到同一个 Message-ID（收件方据此去重）。 */
function deterministicMessageId(idempotencyKey: string, from: string): string {
  const domain = from.split('@')[1] || 'localhost';
  const hash = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  return `<${hash}@${domain}>`;
}

async function sendViaResend(key: string, from: string, input: TransactionalEmail): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`[email] Resend rejected a message to ${input.to}: HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[email] Sending to ${input.to} failed:`, error);
    return false;
  }
}
