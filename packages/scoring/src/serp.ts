import {
  ResultType,
  SerpItemInput,
  SerpItemWeaknessOutput,
  SerpWeaknessResult,
} from './types';

const RANK_WEIGHTS = [0.20, 0.15, 0.12, 0.10, 0.09, 0.08, 0.07, 0.07, 0.06, 0.06];

const BASE_WEAKNESS_MAP: Record<ResultType, number> = {
  SPECIALIST: 0.0,
  OFFICIAL: 0.0,
  EDITORIAL_MEDIA: 0.2,
  LISTICLE_AFFILIATE: 0.3,
  DIRECTORY: 0.3,
  VIDEO: 0.4,
  DOC: 0.5,
  UGC_THREAD: 0.6,
  QA: 0.6,
  THIN_PAGE: 0.7,
  OFF_TOPIC: 0.9,
  UNCLASSIFIED: 0.3,
};

export function calculateSerpWeakness(items: SerpItemInput[]): SerpWeaknessResult {
  // Sort items by rank ascending
  const sorted = [...items].sort((a, b) => a.rank - b.rank);
  const top10 = sorted.filter((item) => item.rank >= 1 && item.rank <= 10);

  const processedItems: SerpItemWeaknessOutput[] = [];
  let weightedWeaknessSum = 0;
  let totalWeight = 0;
  let weakCount = 0;

  for (let i = 0; i < top10.length; i++) {
    const item = top10[i];
    const rankWeight = RANK_WEIGHTS[item.rank - 1] ?? 0.05;

    const baseWeakness = BASE_WEAKNESS_MAP[item.resultType] ?? 0.3;

    // Age adjustment
    let ageAdj = 0;
    const ageDays = item.ageDays ?? 0;
    if (ageDays > 730) {
      ageAdj = 0.2;
    } else if (ageDays > 365) {
      ageAdj = 0.1;
    }

    // Relevance adjustment
    let relevanceAdj = 0;
    if (item.relevance !== undefined && item.relevance < 0.5) {
      relevanceAdj = 0.2;
    }

    const rawTotal = baseWeakness + ageAdj + relevanceAdj;
    const totalWeakness = Math.min(1.0, Math.max(0.0, Math.round(rawTotal * 100) / 100));

    const isWeak = totalWeakness >= 0.5;
    if (isWeak) weakCount++;

    let weaknessType: string | undefined;
    if (item.resultType === 'UGC_THREAD' || item.resultType === 'QA') {
      weaknessType = 'FORUM_OR_QA';
    } else if (item.resultType === 'THIN_PAGE') {
      weaknessType = 'THIN_PAGE';
    } else if (item.resultType === 'OFF_TOPIC') {
      weaknessType = 'OFF_TOPIC';
    } else if (ageAdj > 0) {
      weaknessType = 'OUTDATED_CONTENT';
    } else if (relevanceAdj > 0) {
      weaknessType = 'LOW_RELEVANCE';
    } else if (item.resultType === 'LISTICLE_AFFILIATE') {
      weaknessType = 'AFFILIATE_LISTICLE';
    }

    processedItems.push({
      rank: item.rank,
      url: item.url,
      domain: item.domain,
      title: item.title,
      resultType: item.resultType,
      baseWeakness,
      ageAdj,
      relevanceAdj,
      totalWeakness,
      isWeak,
      weaknessType,
    });

    weightedWeaknessSum += rankWeight * totalWeakness;
    totalWeight += rankWeight;
  }

  // Normalize by total weight if fewer than 10 items
  const normalizedWeakness =
    totalWeight > 0 ? (weightedWeaknessSum / totalWeight) * 100 : 0;
  const score = Math.round(normalizedWeakness * 100) / 100;

  return {
    score,
    items: processedItems,
    weakCount,
  };
}
