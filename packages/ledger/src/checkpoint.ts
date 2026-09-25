import { createHash } from 'node:crypto';
import { MerkleTree } from './merkle';
import { calculateRowHash, VerdictRowData } from './row-hash';

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

export function generateDailyLedger(
  obsDate: string,
  records: { opportunityId: string; data: VerdictRowData }[],
  prevCheckpointHash: string,
  prevRowHash: string
): {
  summary: DailyLedgerSummary;
  hashedRows: { opportunityId: string; prevHash: string; rowHash: string; data: VerdictRowData }[];
  tree: MerkleTree;
} {
  // 1. Sort records by opportunityId ascending per spec §4.2
  const sorted = [...records].sort((a, b) => a.opportunityId.localeCompare(b.opportunityId));

  let currentPrevHash = prevRowHash;
  const hashedRows: {
    opportunityId: string;
    prevHash: string;
    rowHash: string;
    data: VerdictRowData;
  }[] = [];

  for (const item of sorted) {
    const rowHash = calculateRowHash(currentPrevHash, item.data);
    hashedRows.push({
      opportunityId: item.opportunityId,
      prevHash: currentPrevHash,
      rowHash,
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
