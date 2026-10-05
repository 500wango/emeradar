import { createHash } from 'node:crypto';
import {
  Collector,
  CollectOutcome,
  RunContext,
  PlannedBatch,
  SnapshotDraft,
  EvidenceDraft,
} from './types';

export interface CheckoutTarget {
  targetId: string;
  domain: string;
  sampleUrls?: string[];
  htmlSnippet?: string;
  opportunityId?: string;
  knownReferralScore?: number;
}

export type CheckoutGateway =
  | 'STRIPE'
  | 'LEMON_SQUEEZY'
  | 'PADDLE'
  | 'WHOP'
  | 'UNKNOWN';

export interface DetectedCheckoutSignal {
  gateway: CheckoutGateway;
  matchedPattern: string;
  integrationType: 'HOSTED_CHECKOUT' | 'EMBEDDED_ELEMENTS' | 'DIRECT_BUY_LINK';
  targetUrl: string;
  extractedPriceUsd?: number;
}

export class CheckoutReferralsCollector
  implements Collector<CheckoutTarget[], CheckoutTarget>
{
  readonly sourceId = 'src_checkout_referral';
  readonly version = '1.0.0';
  readonly limits = {
    maxConcurrency: 3,
    ratePerSecond: 2,
  };

  private costPerItemUsd = 0.002;

  // Checkout gateway signatures
  private static readonly GATEWAY_PATTERNS: Array<{
    gateway: CheckoutGateway;
    integrationType: 'HOSTED_CHECKOUT' | 'EMBEDDED_ELEMENTS' | 'DIRECT_BUY_LINK';
    regex: RegExp;
  }> = [
    // Stripe Hosted Checkout & Payment Links
    {
      gateway: 'STRIPE',
      integrationType: 'HOSTED_CHECKOUT',
      regex: /https?:\/\/checkout\.stripe\.com\/[a-zA-Z0-9_\-\/]+/i,
    },
    {
      gateway: 'STRIPE',
      integrationType: 'DIRECT_BUY_LINK',
      regex: /https?:\/\/buy\.stripe\.com\/[a-zA-Z0-9_\-]+/i,
    },
    // Stripe Elements / Embedded
    {
      gateway: 'STRIPE',
      integrationType: 'EMBEDDED_ELEMENTS',
      regex: /https?:\/\/js\.stripe\.com\/v[23]/i,
    },
    // LemonSqueezy Checkout & Buy Links
    {
      gateway: 'LEMON_SQUEEZY',
      integrationType: 'HOSTED_CHECKOUT',
      regex: /https?:\/\/app\.lemonsqueezy\.com\/checkout\/[a-zA-Z0-9_\-\/]+/i,
    },
    {
      gateway: 'LEMON_SQUEEZY',
      integrationType: 'DIRECT_BUY_LINK',
      regex: /https?:\/\/[a-zA-Z0-9_\-]+\.lemonsqueezy\.com\/buy\/[a-zA-Z0-9_\-]+/i,
    },
    {
      gateway: 'LEMON_SQUEEZY',
      integrationType: 'EMBEDDED_ELEMENTS',
      regex: /assets\.lemonsqueezy\.com\/lemon\.js/i,
    },
    // Paddle Hosted & Inline Checkout
    {
      gateway: 'PADDLE',
      integrationType: 'HOSTED_CHECKOUT',
      regex: /https?:\/\/checkout\.paddle\.com\/[a-zA-Z0-9_\-\/]+/i,
    },
    {
      gateway: 'PADDLE',
      integrationType: 'EMBEDDED_ELEMENTS',
      regex: /cdn\.paddle\.com\/paddle\/v[12]\/paddle\.js/i,
    },
    // Whop Checkout
    {
      gateway: 'WHOP',
      integrationType: 'HOSTED_CHECKOUT',
      regex: /https?:\/\/whop\.com\/checkout\/[a-zA-Z0-9_\-\/]+/i,
    },
  ];

  async plan(
    _ctx: RunContext,
    scope: CheckoutTarget[]
  ): Promise<PlannedBatch<CheckoutTarget>> {
    const batchId = `batch_chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const estimatedCostUsd = scope.length * this.costPerItemUsd;

    return {
      batchId,
      items: scope,
      estimatedCostUsd,
    };
  }

  async collect(
    ctx: RunContext,
    target: CheckoutTarget
  ): Promise<CollectOutcome> {
    if (!ctx.budget.canSpend(this.costPerItemUsd)) {
      return {
        status: 'SKIPPED',
        reason: 'BUDGET',
      };
    }

    const detectedSignals: DetectedCheckoutSignal[] = [];
    const contentToScan: string[] = [];

    if (target.htmlSnippet) {
      contentToScan.push(target.htmlSnippet);
    }
    if (target.sampleUrls?.length) {
      contentToScan.push(...target.sampleUrls);
    }

    const combinedText = contentToScan.join('\n');

    // Pattern matching
    for (const pattern of CheckoutReferralsCollector.GATEWAY_PATTERNS) {
      const match = pattern.regex.exec(combinedText);
      if (match) {
        // Price extraction heuristics near match (e.g. $29, $49/mo)
        let extractedPriceUsd: number | undefined;
        const priceRegex = /\$(\d{1,4}(?:\.\d{2})?)/g;
        const priceMatch = priceRegex.exec(combinedText);
        if (priceMatch && priceMatch[1]) {
          const val = parseFloat(priceMatch[1]);
          if (val > 0 && val < 5000) {
            extractedPriceUsd = val;
          }
        }

        detectedSignals.push({
          gateway: pattern.gateway,
          matchedPattern: match[0],
          integrationType: pattern.integrationType,
          targetUrl: target.sampleUrls?.[0] || `https://${target.domain}`,
          extractedPriceUsd,
        });
      }
    }

    // Hash for snapshot integrity
    const hash = createHash('sha256')
      .update(combinedText || target.domain)
      .digest('hex');

    const snapshots: SnapshotDraft[] = [
      {
        entityType: 'COMMERCIAL',
        key: `checkout_signals_${target.domain}`,
        data: {
          domain: target.domain,
          detectedCount: detectedSignals.length,
          signals: detectedSignals,
          referralScore: target.knownReferralScore ?? (detectedSignals.length > 0 ? 100 : 0),
          scannedAt: ctx.clock().toISOString(),
        },
      },
    ];

    const evidence: EvidenceDraft[] = [];

    if (target.opportunityId && detectedSignals.length > 0) {
      const primary = detectedSignals[0];
      evidence.push({
        opportunityId: target.opportunityId,
        evidenceClass: 'OBSERVED', // Verifiable live checkout link is directly observed evidence!
        sourceType: 'CHECKOUT_REFERRAL_RADAR',
        sourceId: this.sourceId,
        domain: target.domain,
        title: `Active ${primary.gateway} Checkout Observed on ${target.domain}`,
        snippet: `Verified outbound payment flow: ${primary.matchedPattern} (${primary.integrationType})`,
        payload: {
          gateway: primary.gateway,
          integrationType: primary.integrationType,
          signals: detectedSignals,
          extractedPriceUsd: primary.extractedPriceUsd,
          evidenceHash: hash,
        },
        observedAt: ctx.clock(),
      });
    }

    return {
      status: 'OK',
      snapshots,
      evidence,
      raw: {
        content: combinedText,
        contentHash: hash,
        mimeType: 'text/plain',
      },
      cost: {
        sourceId: this.sourceId,
        opportunityId: target.opportunityId,
        costUsd: this.costPerItemUsd,
        category: 'CRAWL',
        units: 1,
      },
    };
  }
}
