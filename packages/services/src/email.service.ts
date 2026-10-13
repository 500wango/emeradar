/**
 * 交易类邮件的唯一发送器。
 *
 * 这里原本有两份逐字相同的实现（`apps/web/src/lib/email-delivery.ts` 与
 * `pipeline.ts` 里的 `deliverAlertEmail`）。两份的差别只有返回值：一份吞掉失败，
 * 一份连失败都不报。到宽限期催缴要发第三封时，就该收敛了 —— 邮件"发没发出去"
 * 是个必须能回答的问题，而三份各自处理的答案不会一致。
 *
 * 未配置 `RESEND_API_KEY` / `ALERT_FROM_EMAIL` 时返回 `false` 而不抛错：本地与
 * 测试环境没有这两个变量是常态，缺配置不该让调用方的业务流程失败。但调用方必须
 * **看得见**这个 `false`，不能当成功。
 */
export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;
  if (!key || !from || !input.to) return false;

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
