import { createHash } from 'node:crypto';

export interface AuditPathStep {
  hash: string;
  position: 'left' | 'right';
}

export function hashLeaf(dataHex: string): string {
  const hash = createHash('sha256');
  hash.update(Buffer.from([0x00])); // RFC 6962 leaf prefix
  hash.update(Buffer.from(dataHex, 'hex'));
  return hash.digest('hex');
}

export function hashNode(leftHex: string, rightHex: string): string {
  const hash = createHash('sha256');
  hash.update(Buffer.from([0x01])); // RFC 6962 node prefix
  hash.update(Buffer.from(leftHex, 'hex'));
  hash.update(Buffer.from(rightHex, 'hex'));
  return hash.digest('hex');
}

export class MerkleTree {
  private leaves: string[]; // leaf hashes
  private levels: string[][];

  constructor(leafDataHexList: string[]) {
    if (leafDataHexList.length === 0) {
      // Empty tree root
      const emptyHash = createHash('sha256').digest('hex');
      this.leaves = [emptyHash];
      this.levels = [[emptyHash]];
      return;
    }

    this.leaves = leafDataHexList.map((hex) => hashLeaf(hex));
    this.levels = [this.leaves];

    let currentLevel = this.leaves;
    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          nextLevel.push(hashNode(currentLevel[i], currentLevel[i + 1]));
        } else {
          // Promote odd leaf if no pair
          nextLevel.push(currentLevel[i]);
        }
      }
      this.levels.push(nextLevel);
      currentLevel = nextLevel;
    }
  }

  public getRoot(): string {
    return this.levels[this.levels.length - 1][0];
  }

  public getProof(index: number): AuditPathStep[] {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`Index ${index} out of bounds (0 - ${this.leaves.length - 1})`);
    }

    const proof: AuditPathStep[] = [];
    let currentIndex = index;

    for (let level = 0; level < this.levels.length - 1; level++) {
      const currentLevel = this.levels[level];
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < currentLevel.length) {
        proof.push({
          hash: currentLevel[siblingIndex],
          position: isRight ? 'left' : 'right',
        });
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  }

  public static verifyProof(
    expectedRoot: string,
    leafDataHex: string,
    proof: AuditPathStep[]
  ): boolean {
    let currentHash = hashLeaf(leafDataHex);

    for (const step of proof) {
      if (step.position === 'left') {
        currentHash = hashNode(step.hash, currentHash);
      } else {
        currentHash = hashNode(currentHash, step.hash);
      }
    }

    return currentHash.toLowerCase() === expectedRoot.toLowerCase();
  }
}
