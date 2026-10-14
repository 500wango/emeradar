import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createZip, dosDateFromDate, type ZipEntry } from '../src/zip';

/**
 * 手写 ZIP 写入器的验收用例。
 *
 * 这个文件存在的理由只有一个：**写入器不能被自己的读取器验证**。如果断言里用的
 * 解析代码和 `createZip` 出自同一套假设（同一个字段偏移量理解错了，两边一起错），
 * 用例会一路绿到用户拿到一个打不开的压缩包。所以这里做三件事：
 *
 *   1. 用一段**独立按 ZIP 规范写的读取器**把产物解回来——它走的是真实解压工具的
 *      路径（从尾部找 EOCD、读中央目录、按偏移量找本地头），不是复用写入器的中间量。
 *   2. 解出来的字节必须与进去的字节**逐字节相同**。结构正确而内容错位，是最容易
 *      写出来、也最难靠肉眼发现的一种错。
 *   3. 有 `unzip` 时再让一个**真正的第三方实现**验一遍。它不在时不失败（CI 镜像里
 *      未必有），但在时它就是最有说服力的那一条。
 *
 * 另一半理由是确定性（09 §5.3 硬约束 1）：同一输入两次调用必须得到同一串字节。
 * 这条一旦破了，用户拿响应头里的三项版本号去自查"同一份输入是否得到同一份交付物"
 * 就永远对不上。
 */

interface ReadEntry {
  path: string;
  content: Buffer;
  method: number;
  crc: number;
  dosDate: number;
  dosTime: number;
  /** 通用标志位。0x0800 表示文件名是 UTF-8。 */
  flags: number;
}

/**
 * 按规范从尾部读回一份 zip。
 *
 * EOCD 在结尾，但注释是变长的，所以从尾部往回找签名；找到之后中央目录的偏移与长度
 * 就是权威——本地文件头只用来再核一遍三件事（签名、方法、路径），不参与定位。
 */
function readZip(buffer: Buffer): ReadEntry[] {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notStrictEqual(eocd, -1, 'ZIP 里找不到中央目录结束记录（EOCD）');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  assert.strictEqual(buffer.readUInt16LE(eocd + 8), entryCount, '本磁盘条目数与总条目数不一致');
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  assert.strictEqual(centralOffset + centralSize, eocd, '中央目录没有紧邻 EOCD');

  const entries: ReadEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index++) {
    assert.strictEqual(buffer.readUInt32LE(cursor), 0x02014b50, `第 ${index} 条中央目录头签名不对`);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const dosTime = buffer.readUInt16LE(cursor + 12);
    const dosDate = buffer.readUInt16LE(cursor + 14);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const path = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    // 本地文件头：解压工具最先读的就是它，所以这里按它自己的字段走一遍。
    assert.strictEqual(buffer.readUInt32LE(localOffset), 0x04034b50, `${path} 的本地文件头签名不对`);
    assert.strictEqual(buffer.readUInt16LE(localOffset + 8), method, `${path} 的两处压缩方法不一致`);
    assert.strictEqual(buffer.readUInt32LE(localOffset + 14), crc, `${path} 的两处 CRC 不一致`);
    assert.strictEqual(buffer.readUInt32LE(localOffset + 18), compressedSize, `${path} 的两处压缩长度不一致`);
    assert.strictEqual(buffer.readUInt32LE(localOffset + 22), uncompressedSize, `${path} 的两处原始长度不一致`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localName = buffer
      .subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .toString('utf8');
    assert.strictEqual(localName, path, '本地文件头与中央目录的文件名不一致');

    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? inflateRawSync(payload) : Buffer.from(payload);
    assert.strictEqual(content.length, uncompressedSize, `${path} 解出来长度不对`);

    entries.push({ path, content, method, crc, dosDate, dosTime, flags });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.strictEqual(cursor, centralOffset + centralSize, '中央目录的实际长度与记录不符');
  return entries;
}

/** 固定种子的 xorshift32：可复现，且输出不可压缩。 */
function pseudoRandomBytes(length: number): Buffer {
  const bytes = Buffer.alloc(length);
  let state = 0x12345678;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

function sampleEntries(): ZipEntry[] {
  return [
    { path: 'CLAUDE.md', content: Buffer.from('# 工程规范\n\n可压缩的重复文本。'.repeat(40), 'utf8') },
    { path: '.cursorrules', content: Buffer.from('- 只实现 MVP\n- 不引入额外依赖\n', 'utf8') },
    // 已经压过的内容：deflate 只会把它变大，所以必须落成 store。
    { path: 'routes.yaml', content: Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251).map(String), 'utf8') },
    { path: 'keywords.csv', content: Buffer.alloc(0) },
  ];
}

describe('确定性 ZIP 写入器', () => {
  it('写出来的东西能被独立读取器逐字节解回来', () => {
    const entries = sampleEntries();
    const zip = createZip(entries, { dosDate: dosDateFromDate('2026-06-01') });
    const read = readZip(zip);

    assert.deepStrictEqual(
      read.map((entry) => entry.path),
      entries.map((entry) => entry.path),
      '条目顺序改变了'
    );
    for (const [index, entry] of read.entries()) {
      assert.deepStrictEqual(entry.content, entries[index].content, `${entry.path} 解出来的内容与原始内容不同`);
      // 文件名带 UTF-8 标志位：`.cursorrules` 是 ASCII，但用户仓库里的路径未必。
      assert.strictEqual(entry.flags & 0x0800, 0x0800, `${entry.path} 缺少 UTF-8 文件名标志位`);
    }
  });

  it('压不小的条目落成 store，而不是把体积写大', () => {
    const entries: ZipEntry[] = [
      // 伪随机且不可压缩：deflate 对这类数据最好也只能原样存储，代价是每块 5 个字节的
      // 头，所以输出一定比输入长。用固定种子的 xorshift 而不是 Math.random，免得这条
      // 用例的成功与否取决于运气。
      { path: 'blob.bin', content: pseudoRandomBytes(2048) },
      { path: 'text.md', content: Buffer.from('same line\n'.repeat(200), 'utf8') },
    ];
    const read = readZip(createZip(entries, { dosDate: dosDateFromDate('2026-06-01') }));

    assert.strictEqual(read[0].method, 0, '不可压缩的条目被 deflate 了');
    assert.strictEqual(read[1].method, 8, '可压缩的条目没有被 deflate');
    for (const [index, entry] of read.entries()) {
      assert.deepStrictEqual(entry.content, entries[index].content);
    }
  });

  it('时间戳来自调用方给的观测日，运行时刻不会漏进字节里', () => {
    const dosDate = dosDateFromDate('2026-06-01');
    const first = createZip(sampleEntries(), { dosDate });
    // 中间隔一次真实的时间流逝：任何读了 now() 的实现都会在这里露馅。
    const started = Date.now();
    while (Date.now() - started < 5) {
      /* 忙等，确保两次调用落在不同的毫秒上 */
    }
    const second = createZip(sampleEntries(), { dosDate });

    assert.deepStrictEqual(first, second, '同一输入两次打包得到了不同的字节串');
    for (const entry of readZip(first)) {
      assert.strictEqual(entry.dosDate, dosDate);
      assert.strictEqual(entry.dosTime, 0);
    }
    // 2026-06-01 → (46 << 9) | (6 << 5) | 1
    assert.strictEqual(dosDate, (46 << 9) | (6 << 5) | 1);
  });

  it('DOS 日期解析失败时退回 1980-01-01，而不是退回"现在"', () => {
    const epoch = (0 << 9) | (1 << 5) | 1;
    assert.strictEqual(dosDateFromDate(''), epoch);
    assert.strictEqual(dosDateFromDate('not-a-date'), epoch);
    assert.strictEqual(dosDateFromDate('1979-12-31'), epoch);
    // 带时间后缀的 ISO 串照常解析：快照的 obs_date 常常是 `YYYY-MM-DDTHH:mm:ssZ`。
    assert.strictEqual(dosDateFromDate('2026-06-01T00:00:00.000Z'), dosDateFromDate('2026-06-01'));
  });

  it('真正的第三方实现读得动它（没有 unzip 就跳过）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emeradar-zip-'));
    const path = join(dir, 'kit.zip');
    try {
      const entries = sampleEntries();
      writeFileSync(path, createZip(entries, { dosDate: dosDateFromDate('2026-06-01') }));
      let listing: string;
      try {
        execFileSync('unzip', ['-t', path], { stdio: 'pipe' });
        listing = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' });
      } catch (error: any) {
        if (error?.code === 'ENOENT') return; // 环境里没有 unzip：这时不失败，只是少一层验证
        throw error;
      }
      assert.deepStrictEqual(
        listing.trim().split('\n').map((line) => line.trim()),
        entries.map((entry) => entry.path),
        'unzip 看到的条目清单与写入的条目不一致'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
