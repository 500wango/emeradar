import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { emailTransport, sendTransactionalEmail } from '../src/email.service';

const EMAIL_ENV = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  'ALERT_FROM_EMAIL',
  'RESEND_API_KEY',
] as const;

/**
 * 每个用例都从"这台机器什么都没配"开始，再只打开它要验证的那个通道——否则测试
 * 结果会取决于跑测试的人 `.env` 里有什么，那就不叫验证了。
 */
async function withEmailEnv(
  vars: Partial<Record<(typeof EMAIL_ENV)[number], string>>,
  fn: () => Promise<void>
): Promise<void> {
  const saved = EMAIL_ENV.map((key) => [key, process.env[key]] as const);
  for (const key of EMAIL_ENV) delete process.env[key];
  Object.assign(process.env, vars);
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * 一个只够用的 SMTP 服务器：不广告 STARTTLS、不广告 AUTH，收下 DATA 就存下来。
 * 用它而不是 mock 掉 nodemailer，是因为要验证的正是"这个连接真的把信交出去了"
 * ——连接、信封命令、DATA 内容这些都是待验证的东西，mock 掉就等于不验。
 */
async function startFakeSmtp(options: { rejectRecipients?: boolean } = {}): Promise<{
  port: number;
  messages: string[];
  close: () => Promise<void>;
}> {
  const messages: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    let inData = false;
    let body = '';
    socket.write('220 fake.local ESMTP\r\n');
    socket.on('error', () => {});
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(body);
            body = '';
            socket.write('250 2.0.0 queued\r\n');
          } else {
            body += `${line}\n`;
          }
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith('EHLO') || command.startsWith('HELO')) {
          socket.write('250-fake.local\r\n250 SIZE 10485760\r\n');
        } else if (command.startsWith('MAIL FROM')) {
          body = '';
          socket.write('250 2.1.0 ok\r\n');
        } else if (command.startsWith('RCPT TO')) {
          socket.write(options.rejectRecipients ? '550 5.1.1 no such user\r\n' : '250 2.1.5 ok\r\n');
        } else if (command === 'DATA') {
          inData = true;
          socket.write('354 end data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'RSET') {
          socket.write('250 2.0.0 ok\r\n');
        } else if (command === 'QUIT') {
          socket.write('221 2.0.0 bye\r\n');
          socket.end();
        } else {
          socket.write('250 2.0.0 ok\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    port: address.port,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        // 测试里被拒的那个用例里，客户端可能还留着一条没走到 QUIT 的连接：先掐掉，
        // 否则 server.close() 会一直等它，测试就挂住了。
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function header(message: string, name: string): string | undefined {
  return message.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1];
}

/**
 * nodemailer 用 quoted-printable 编正文（长行会插软换行、`=` 会写成 `=3D`），
 * 所以要还原之后再断言正文内容 —— 否则断言失败的原因会是编码而不是行为。
 */
function decodeQuotedPrintable(message: string): string {
  return message
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

test('SMTP 通道把邮件真的交给服务器，且同一幂等键派生出同一个 Message-ID', async () => {
  const server = await startFakeSmtp();
  const httpCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    httpCalls.push(String(url));
    return { ok: true };
  }) as unknown as typeof globalThis.fetch;

  try {
    await withEmailEnv(
      {
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(server.port),
        SMTP_SECURE: 'false',
        MAIL_FROM: 'no-reply@emeradar.test',
      },
      async () => {
        assert.equal(emailTransport(), 'smtp');
        const message = {
          to: 'user@example.invalid',
          subject: 'Verify your Emeradar email',
          text: 'Verify your Emeradar account within 24 hours: https://emeradar.com/verify-email?token=abc',
          idempotencyKey: 'alert/rule-1/2026-10-13',
        };
        assert.equal(await sendTransactionalEmail(message), true);
        // 第二次调用模拟任务重试：同一把幂等键。
        assert.equal(await sendTransactionalEmail(message), true);
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }

  assert.equal(httpCalls.length, 0, 'SMTP 已配置时不该回落到 Resend');
  assert.equal(server.messages.length, 2);
  for (const message of server.messages) {
    assert.equal(header(message, 'To'), 'user@example.invalid');
    assert.equal(header(message, 'From'), 'no-reply@emeradar.test');
    assert.equal(header(message, 'Subject'), 'Verify your Emeradar email');
    assert.match(header(message, 'Message-ID') ?? '', /^<[0-9a-f]{32}@emeradar\.test>$/);
    assert.match(decodeQuotedPrintable(message), /verify-email\?token=abc/);
  }
  assert.equal(
    header(server.messages[0], 'Message-ID'),
    header(server.messages[1], 'Message-ID'),
    '同一个幂等键两次发送必须得到同一个 Message-ID（收件方据此去重）'
  );
});

test('收件人被服务器拒收时返回 false，不把“连上了”当成送达', async () => {
  const server = await startFakeSmtp({ rejectRecipients: true });
  try {
    await withEmailEnv(
      {
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(server.port),
        SMTP_SECURE: 'false',
        MAIL_FROM: 'no-reply@emeradar.test',
      },
      async () => {
        const ok = await sendTransactionalEmail({ to: 'user@example.invalid', subject: 'Test', text: 'Test' });
        assert.equal(ok, false);
      }
    );
  } finally {
    await server.close();
  }
});

test('Resend 通道在重试时携带稳定的幂等键和有界超时', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).get('Idempotency-Key'), 'alert/test-event');
    assert.ok(init.signal);
    return { ok: true };
  }) as unknown as typeof globalThis.fetch;

  try {
    await withEmailEnv({ RESEND_API_KEY: 'test-placeholder', ALERT_FROM_EMAIL: 'test@example.invalid' }, async () => {
      assert.equal(emailTransport(), 'resend');
      const message = { to: 'user@example.invalid', subject: 'Test', text: 'Test', idempotencyKey: 'alert/test-event' };
      assert.equal(await sendTransactionalEmail(message), true);
      assert.equal(await sendTransactionalEmail(message), true);
      assert.equal(calls, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('两个通道都没配时返回 false —— 缺配置不能静默变成“已发送”', async () => {
  await withEmailEnv({ MAIL_FROM: 'no-reply@emeradar.test' }, async () => {
    assert.equal(emailTransport(), 'none');
    assert.equal(
      await sendTransactionalEmail({ to: 'user@example.invalid', subject: 'Test', text: 'Test' }),
      false
    );
  });
});
