import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';

/**
 * 极小的确定性 ZIP 写入器（store/deflate + 固定时间戳）。
 *
 * 为什么自己写而不是拉一个库：09 §5.3 硬约束 1 要求同一
 * `(opportunity_id, snapshot_id, archetype, template_version)` 产出 **bit-for-bit
 * 相同** 的点火包。多数 zip 库会把"当前时间"写进本地文件头与中央目录，于是同样的
 * 输入两次导出得到两个不同的字节串——用户的"同一份输入必然得到同一份交付物"自查
 * 就永远对不上，而我们恰恰把这三项版本号放进响应头让他去对。
 *
 * 所以这里把 DOS 时间戳固定成由调用方给的 `dosTime`（点火包用快照观测日），
 * 压缩级别固定，条目顺序固定，不留任何"运行时刻"的痕迹。CRC32 用 zlib 自带的实现
 * ——它本身就是确定性函数，没必要再手抄一张表。
 */

export interface ZipEntry {
  path: string;
  content: Buffer;
  /** deflate 更小，但 store 更快也更可预测；两者都是确定性的。 */
  compress?: boolean;
}

export interface ZipOptions {
  /**
   * DOS 时间戳（`(year-1980) << 9 | month << 5 | day`）。**绝不默认取 now()**：
   * 默认值就是上面说的那个可复现性缺口，让它显式存在，调用方就必须作出选择。
   */
  dosDate: number;
  dosTime?: number;
}

/** 中央目录与本地文件头共用的字段，写成一条以免两处漂移。 */
interface EntryMeta {
  path: Buffer;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  offset: number;
}

export function createZip(entries: readonly ZipEntry[], options: ZipOptions): Buffer {
  const dosTime = options.dosTime ?? 0;
  const dosDate = options.dosDate;

  const locals: Buffer[] = [];
  const metas: EntryMeta[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const compressed = entry.compress === false ? entry.content : deflateRawSync(entry.content, { level: 6 });
    // 压不小就存原文：deflate 对已经压过的内容反而会变大，而"变大"这件事本身
    // 不该进入交付物。
    const useDeflate = compressed.length < entry.content.length;
    const payload = useDeflate ? compressed : entry.content;
    const method = useDeflate ? 8 : 0;
    const crc = zlibCrc32(entry.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // 需要的版本 2.0
    local.writeUInt16LE(0x0800, 6); // 通用标志位：文件名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // 无扩展字段

    locals.push(local, name, payload);
    metas.push({
      path: name,
      crc,
      compressedSize: payload.length,
      uncompressedSize: entry.content.length,
      method,
      offset,
    });
    offset += local.length + name.length + payload.length;
  }

  const central: Buffer[] = [];
  let centralSize = 0;
  for (const meta of metas) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); // 中央目录头签名
    header.writeUInt16LE(20, 4); // 创建版本
    header.writeUInt16LE(20, 6); // 需要的版本
    header.writeUInt16LE(0x0800, 8); // UTF-8 文件名
    header.writeUInt16LE(meta.method, 10);
    header.writeUInt16LE(dosTime, 12);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(meta.crc, 16);
    header.writeUInt32LE(meta.compressedSize, 20);
    header.writeUInt32LE(meta.uncompressedSize, 24);
    header.writeUInt16LE(meta.path.length, 28);
    header.writeUInt16LE(0, 30); // 无扩展字段
    header.writeUInt16LE(0, 32); // 无注释
    header.writeUInt16LE(0, 34); // 起始磁盘号
    header.writeUInt16LE(0, 36); // 内部属性
    header.writeUInt32LE(0, 38); // 外部属性（0 = 无 unix 权限位，跨平台一致）
    header.writeUInt32LE(meta.offset, 42);
    central.push(header, meta.path);
    centralSize += header.length + meta.path.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // 中央目录结束记录
  end.writeUInt16LE(0, 4); // 本磁盘号
  end.writeUInt16LE(0, 6); // 中央目录起始磁盘号
  end.writeUInt16LE(metas.length, 8);
  end.writeUInt16LE(metas.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // 无注释

  return Buffer.concat([...locals, ...central, end]);
}

/**
 * 把 `YYYY-MM-DD` 转成 ZIP 用的 DOS 日期。
 *
 * 解析失败时返回 1980-01-01（DOS 纪元）而不是抛错：一个缺失的观测日不该让整份
 * 点火包导不出来，而 1980-01-01 是一个**显式的**"日期不可用"，不是伪装成现在。
 */
export function dosDateFromDate(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return (0 << 9) | (1 << 5) | 1;
  const year = Number(match[1]) - 1980;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || year < 0) return (0 << 9) | (1 << 5) | 1;
  return (year << 9) | (month << 5) | day;
}
