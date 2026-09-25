import {
  EntityMergePair,
  PricingExtractionResult,
  PricingTier,
  SerpClassifiedItem,
} from './types';

/**
 * 08 §3: U1 Entity Deduplication / Merging
 */
export class EntityDeduplicator {
  static deduplicate(
    candidate: string,
    existingEntities: Array<{ id: string; name: string; aliases?: string[] }>
  ): EntityMergePair {
    const normCand = candidate.trim().toLowerCase();

    let bestMatch: { id: string; name: string } | null = null;
    let highestSim = 0.0;

    for (const ent of existingEntities) {
      const allNames = [ent.name, ...(ent.aliases || [])];
      for (const n of allNames) {
        const sim = this.calculateSimilarity(normCand, n.trim().toLowerCase());
        if (sim > highestSim) {
          highestSim = sim;
          bestMatch = ent;
        }
      }
    }

    if (highestSim >= 0.90 && bestMatch) {
      return {
        candidate,
        matchedEntityId: bestMatch.id,
        confidence: Math.round(highestSim * 100) / 100,
        reason: `High lexical similarity (${Math.round(highestSim * 100)}%) with "${bestMatch.name}"`,
      };
    } else if (highestSim >= 0.60 && bestMatch) {
      return {
        candidate,
        matchedEntityId: bestMatch.id,
        confidence: Math.round(highestSim * 100) / 100,
        reason: `Moderate similarity (${Math.round(highestSim * 100)}%) with "${bestMatch.name}" - requires review`,
      };
    }

    return {
      candidate,
      matchedEntityId: null,
      confidence: Math.round(highestSim * 100) / 100,
      reason: 'No matching entity found above threshold',
    };
  }

  private static calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;

    // Bigram Dice coefficient
    const getBigrams = (str: string) => {
      const s = new Set<string>();
      for (let i = 0; i < str.length - 1; i++) {
        s.add(str.substring(i, i + 2));
      }
      return s;
    };

    const bigramsA = getBigrams(a);
    const bigramsB = getBigrams(b);
    let intersection = 0;

    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) intersection++;
    }

    return (2 * intersection) / (bigramsA.size + bigramsB.size);
  }
}

/**
 * 08 §4: U2 SERP Result Classifier (Rule-first, LLM fallback)
 */
export class SerpResultClassifier {
  static classify(
    rawResults: Array<{
      rank: number;
      url: string;
      domain: string;
      title: string;
      snippet: string;
    }>
  ): SerpClassifiedItem[] {
    return rawResults.map((r) => {
      const urlLower = r.url.toLowerCase();
      const domainLower = r.domain.toLowerCase();
      const titleLower = r.title.toLowerCase();
      const snippetLower = r.snippet.toLowerCase();

      // Rule 1: Community forum & QA
      if (
        domainLower.includes('reddit.com') ||
        domainLower.includes('stackoverflow.com') ||
        domainLower.includes('news.ycombinator.com') ||
        urlLower.includes('/forum/') ||
        urlLower.includes('/community/')
      ) {
        return {
          rank: r.rank,
          resultType: 'UGC_THREAD',
          relevance: 0.85,
          isSpecialist: false,
          reason: 'Recognized forum / community discussion thread',
        };
      }

      if (
        domainLower.includes('quora.com') ||
        domainLower.includes('answers.') ||
        urlLower.includes('/questions/')
      ) {
        return {
          rank: r.rank,
          resultType: 'QA',
          relevance: 0.8,
          isSpecialist: false,
          reason: 'Recognized Q&A question answer portal',
        };
      }

      // Rule 2: Video & Documentation
      if (domainLower.includes('youtube.com') || domainLower.includes('vimeo.com')) {
        return {
          rank: r.rank,
          resultType: 'VIDEO',
          relevance: 0.75,
          isSpecialist: false,
          reason: 'Video sharing platform',
        };
      }

      if (
        urlLower.includes('docs.') ||
        urlLower.includes('/docs/') ||
        urlLower.includes('documentation') ||
        domainLower.includes('gitbook.io')
      ) {
        return {
          rank: r.rank,
          resultType: 'DOC',
          relevance: 0.9,
          isSpecialist: true,
          reason: 'Technical documentation repository',
        };
      }

      // Rule 3: Editorial & Affiliate Listicles
      if (
        titleLower.includes('top 10') ||
        titleLower.includes('best ') && (titleLower.includes('2025') || titleLower.includes('2026') || titleLower.includes('review')) ||
        snippetLower.includes('affiliate commission')
      ) {
        return {
          rank: r.rank,
          resultType: 'LISTICLE_AFFILIATE',
          relevance: 0.8,
          isSpecialist: false,
          reason: 'Review roundup / affiliate comparison listicle',
        };
      }

      // Rule 4: Directories
      if (
        domainLower.includes('capterra.com') ||
        domainLower.includes('g2.com') ||
        domainLower.includes('producthunt.com')
      ) {
        return {
          rank: r.rank,
          resultType: 'DIRECTORY',
          relevance: 0.85,
          isSpecialist: false,
          reason: 'Software catalog / product directory',
        };
      }

      // Rule 5: Generic encyclopedia / off-topic
      if (domainLower.includes('wikipedia.org')) {
        return {
          rank: r.rank,
          resultType: 'OFF_TOPIC',
          relevance: 0.3,
          isSpecialist: false,
          reason: 'Broad encyclopedia reference',
        };
      }

      // Rule 6: Official & Specialist
      if (
        r.url.endsWith('/') ||
        r.url.endsWith('/index.html') ||
        titleLower.includes('official')
      ) {
        return {
          rank: r.rank,
          resultType: 'OFFICIAL',
          relevance: 0.95,
          isSpecialist: true,
          reason: 'Root product official page',
        };
      }

      return {
        rank: r.rank,
        resultType: 'SPECIALIST',
        relevance: 0.9,
        isSpecialist: true,
        reason: 'Specialist vertical web application or tool',
      };
    });
  }
}

/**
 * 08 §5: U3 Pricing Tier Extractor with Literal Verification Guard
 */
export class PricingTierExtractor {
  /**
   * Extracts pricing tiers and strictly verifies that price_text appears literally in the visible text.
   */
  static extractWithLiteralGuard(visibleText: string): PricingExtractionResult {
    const rawTiers: PricingTier[] = [];
    const hasCheckoutEntry =
      visibleText.includes('checkout.stripe.com') ||
      visibleText.includes('stripe-pricing-table') ||
      visibleText.includes('paypal.com') ||
      visibleText.includes('Buy Now') ||
      visibleText.includes('Subscribe Now') ||
      visibleText.includes('Get Started');

    // Regex to find candidate pricing expressions: $19/mo, €29/month, $99/year, Free
    const priceRegex = /(\$|€|£|¥)\s*(\d+(?:\.\d{2})?)\s*(?:\/|\s*per\s*)?(mo|month|yr|year)?/gi;
    let match: RegExpExecArray | null;

    const planNames = ['Starter', 'Hobby', 'Basic', 'Pro', 'Growth', 'Team', 'Business', 'Enterprise'];

    for (const name of planNames) {
      const idx = visibleText.indexOf(name);
      if (idx !== -1) {
        const windowText = visibleText.slice(idx, Math.min(visibleText.length, idx + 200));
        priceRegex.lastIndex = 0;
        match = priceRegex.exec(windowText);

        if (match) {
          const priceText = match[0].trim();
          const currency = match[1];
          const priceAmount = parseFloat(match[2]);
          const periodUnit = match[3]?.toLowerCase();

          // 08 §5 Literal Verification: price_text must appear verbatim in visibleText
          if (visibleText.includes(priceText)) {
            let billingPeriod: 'MONTH' | 'YEAR' | 'UNKNOWN' = 'UNKNOWN';
            if (periodUnit?.startsWith('m')) billingPeriod = 'MONTH';
            else if (periodUnit?.startsWith('y')) billingPeriod = 'YEAR';

            rawTiers.push({
              name,
              priceText,
              priceAmount,
              currency,
              billingPeriod,
              isFree: priceAmount === 0,
            });
          }
        }
      }
    }

    // Check for free tier
    if (visibleText.includes('Free') && visibleText.includes('$0')) {
      rawTiers.unshift({
        name: 'Free',
        priceText: '$0',
        priceAmount: 0,
        currency: '$',
        billingPeriod: 'MONTH',
        isFree: true,
      });
    }

    return {
      tiers: rawTiers,
      hasCheckoutEntry,
    };
  }
}
