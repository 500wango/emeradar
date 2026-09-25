import { createHash } from 'node:crypto';
import { canonicalizeJson } from './canonical';
import { Verdict, Lifecycle, Confidence } from '@emeradar/core';

export interface VerdictRowData {
  opportunityId: string;
  obsDate: string; // YYYY-MM-DD
  scoringConfigVersion: string;
  verdict: Verdict;
  lifecycle: Lifecycle;
  dBasisPoints: number;
  mBasisPoints: number;
  wBasisPoints: number;
  confidence: Confidence;
  inputSnapshotIds: string[];
  citedEvidenceIds: string[];
}

export const GENESIS_PREV_HASH = '0'.repeat(64);

export function calculateRowHash(
  prevHash: string,
  rowData: VerdictRowData
): string {
  // Sort snapshot and evidence IDs to guarantee order independence if needed
  const normalizedData = {
    ...rowData,
    inputSnapshotIds: [...rowData.inputSnapshotIds].sort(),
    citedEvidenceIds: [...rowData.citedEvidenceIds].sort(),
  };

  const canonicalBody = canonicalizeJson(normalizedData);
  const hash = createHash('sha256');
  hash.update(prevHash, 'utf8');
  hash.update(canonicalBody, 'utf8');
  return hash.digest('hex');
}

export function verifyRowHash(
  prevHash: string,
  rowData: VerdictRowData,
  expectedRowHash: string
): boolean {
  const calculated = calculateRowHash(prevHash, rowData);
  return calculated.toLowerCase() === expectedRowHash.toLowerCase();
}
