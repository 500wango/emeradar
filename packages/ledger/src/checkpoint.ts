import { createHash } from 'node:crypto';
import { MerkleTree } from './merkle';
import { calculateRowHash, isV2Row, HashVersion, VerdictRowData } from './row-hash';

export interface DailyLedgerSummary {
  obsDate: string; // YYYY-MM-DD
  rowCount: number;
  merkleRoot: string;
  finalRowHash: string;
  checkpointHash: string;
  prevCheckpointHash: string;
}

export function calculateCheckpointHash(
  prevCheckpointHash: string,
  obsDate: string,
  rowCount: number,
  merkleRoot: string
): string {
  const hash = createHash('sha256');
  hash.update(prevCheckpointHash, 'utf8');
  hash.update(obsDate, 'utf8');
  hash.update(String(rowCount), 'utf8');
  hash.update(merkleRoot, 'utf8');
  return hash.digest('hex');
}

export interface DailyLedgerRecord {
  opportunityId: string;
  data: VerdictRowData;
  /** 省略时由数据形状推断（带 rawVerdict 即 v2）。 */
  hashVersion?: HashVersion;
}

export function generateDailyLedger(
  obsDate: string,
  records: DailyLedgerRecord[],
  prevCheckpointHash: string,
  prevRowHash: string
): {
  summary: DailyLedgerSummary;
  hashedRows: {
    opportunityId: string;
    prevHash: string;
    rowHash: string;
    hashVersion: HashVersion;
    data: VerdictRowData;
  }[];
  tree: MerkleTree;
} {
  // 1. Sort records by opportunityId ascending per spec §4.2.
  //    Byte order, not `localeCompare`: ICU collation varies with the host's
  //    locale data, and any change here reorders the hash chain and invalidates
  //    every previously published Merkle root.
  const sorted = [...records].sort((a, b) =>
    a.opportunityId < b.opportunityId ? -1 : a.opportunityId > b.opportunityId ? 1 : 0
  );

  let currentPrevHash = prevRowHash;
  const hashedRows: {
    opportunityId: string;
    prevHash: string;
    rowHash: string;
    hashVersion: HashVersion;
    data: VerdictRowData;
  }[] = [];

  for (const item of sorted) {
    const hashVersion = item.hashVersion ?? (isV2Row(item.data) ? 2 : 1);
    const rowHash = calculateRowHash(currentPrevHash, item.data);
    hashedRows.push({
      opportunityId: item.opportunityId,
      prevHash: currentPrevHash,
      rowHash,
      hashVersion,
      data: item.data,
    });
    currentPrevHash = rowHash;
  }

  // 2. Build Merkle tree from row_hashes
  const rowHashes = hashedRows.map((r) => r.rowHash);
  const tree = new MerkleTree(rowHashes);
  const merkleRoot = tree.getRoot();

  // 3. Compute Checkpoint Hash
  const checkpointHash = calculateCheckpointHash(
    prevCheckpointHash,
    obsDate,
    sorted.length,
    merkleRoot
  );

  return {
    summary: {
      obsDate,
      rowCount: sorted.length,
      merkleRoot,
      finalRowHash: currentPrevHash,
      checkpointHash,
      prevCheckpointHash,
    },
    hashedRows,
    tree,
  };
}
