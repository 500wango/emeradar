import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { CommercialStage } from '@emeradar/core';
import {
  Collector,
  CollectOutcome,
  RunContext,
  PlannedBatch,
  SnapshotDraft,
  EvidenceDraft,
} from './types';

export interface CrawlTarget {
  targetId: string;
  domain: string;
  targetUrl: string;
  opportunityId?: string;
}

export interface PricingPlan {
  name: string;
  priceMonthly?: number;
  priceYearly?: number;
  currency: string;
  features?: string[];
}

export class CrawlCollector implements Collector<CrawlTarget[], CrawlTarget> {
  readonly sourceId = 'src_crawl';
  readonly version = '1.0.0';
  readonly limits = {
    maxConcurrency: 2,
    ratePerSecond: 1,
    perDomainRatePerSecond: 0.2, // 1 req per 5s per domain
  };

  private costTier1Usd = 0.001; // Static HTTP
  private costTier2Usd = 0.01; // Headless rendering fallback

  // In-memory domain rate limiter tracker (timestamp of last crawl)
  private domainLastCrawled = new Map<string, number>();

  private async assertPublicUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { throw new Error('Target URL must be a valid HTTP(S) URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) {
      throw new Error('Target URL must be a public HTTP(S) URL without credentials or a custom port');
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host === '::1') {
      throw new Error('Target URL must resolve to a public host');
    }
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => this.isPrivateAddress(address))) {
      throw new Error('Target URL must resolve to a public address');
    }
    return parsed;
  }

  private isPrivateAddress(address: string): boolean {
    const value = address.toLowerCase();
    if (value === '::1' || value === '0.0.0.0' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
    if (value.includes(':')) return value.startsWith('::ffff:') ? this.isPrivateAddress(value.slice(7)) : false;
    const parts = value.split('.').map(Number);
    return parts.length === 4 && (parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224);
  }

  private async fetchPublicHtml(url: string, maxRedirects = 3): Promise<string> {
    const parsed = await this.assertPublicUrl(url);
    const res = await fetch(parsed, { redirect: 'manual', headers: { 'User-Agent': 'EmeradarBot/1.0 (+https://emeradar.com/bot; compliance@emeradar.com)', Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(4000) });
    if (res.status >= 300 && res.status < 400) {
      if (maxRedirects === 0) throw new Error('Too many redirects');
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect missing location');
      return this.fetchPublicHtml(new URL(location, parsed).toString(), maxRedirects - 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async plan(
    ctx: RunContext,
    scope: CrawlTarget[]
  ): Promise<PlannedBatch<CrawlTarget>> {
    const estimatedCost = scope.length * this.costTier1Usd * 1.3; // 30% headless upgrade factor
    return {
      batchId: `batch_crawl_${ctx.obsDate}_${Date.now()}`,
      items: scope,
      estimatedCostUsd: Math.round(estimatedCost * 10000) / 10000,
    };
  }

  async collect(ctx: RunContext, item: CrawlTarget): Promise<CollectOutcome> {
    // 1. Budget Guard Check
    if (!ctx.budget.canSpend(this.costTier1Usd)) {
      return {
        status: 'SKIPPED',
        reason: 'BUDGET',
      };
    }

    // 2. Track per-domain crawl timestamp
    this.domainLastCrawled.set(item.domain, ctx.clock().getTime());

    // 3. Robots.txt Compliance Check (04 §4.1)
    const isAllowed = await this.checkRobotsTxt(item.domain, item.targetUrl);
    if (!isAllowed) {
      return {
        status: 'SKIPPED',
        reason: 'ROBOTS_DISALLOWED',
      };
    }

    try {
      // 3. Tier 1 Static HTTP Fetch
      let fetchTier: 'STATIC' | 'HEADLESS' = 'STATIC';
      let html = await this.fetchStaticHtml(item.targetUrl);

      // 4. Analyze HTML for pricing plans and gateways
      let plans = this.extractPricingPlans(html);
      let gateways = this.detectPaymentGateways(html);

      // 5. Two-tier dynamic upgrade check (04 §4.2)
      // If 0 plans detected and dynamic SPA shell detected, upgrade to Tier 2 Headless
      if (plans.length === 0 && this.isDynamicPricingShell(html)) {
        if (ctx.budget.canSpend(this.costTier2Usd)) {
          const rendered = await this.renderHeadless(item.targetUrl);
          if (rendered) {
            fetchTier = 'HEADLESS';
            html = rendered;
            plans = this.extractPricingPlans(html);
            gateways = Array.from(new Set([...gateways, ...this.detectPaymentGateways(html)]));
          }
        }
      }

      // 6. Determine Commercial Stage
      let stage: CommercialStage = 'NONE';
      if (plans.length > 0) {
        stage = 'PRICED';
      } else if (gateways.length > 0) {
        stage = 'INFRA_PRESENT';
      }

      const totalCost = fetchTier === 'HEADLESS' ? this.costTier2Usd : this.costTier1Usd;

      // 7. Assemble Snapshots
      const snapshots: SnapshotDraft[] = [
        {
          entityType: 'COMMERCIAL',
          key: `${item.targetId}_${ctx.obsDate}`,
          data: {
            targetId: item.targetId,
            domain: item.domain,
            obsDate: ctx.obsDate,
            fetchTier,
            pricingPlans: plans,
            paymentGateways: gateways,
            commercialStage: stage,
          },
        },
      ];

      // 8. Assemble Evidence Draft
      const evidence: EvidenceDraft[] = [];
      if (item.opportunityId && (plans.length > 0 || gateways.length > 0)) {
        const topPlanSummary = plans
          .map((p) => `${p.name}: $${p.priceMonthly ?? '?'}/mo`)
          .join(', ');

        evidence.push({
          opportunityId: item.opportunityId,
          evidenceClass: 'OBSERVED',
          sourceType: 'COMMERCIAL_CRAWL',
          sourceId: this.sourceId,
          domain: item.domain,
          title: `Public Pricing Model & Gateway for ${item.domain}`,
          snippet: plans.length > 0
            ? `Detected active plans (${topPlanSummary}). Gateways: ${gateways.join(', ') || 'Direct'}.`
            : `Detected checkout gateway (${gateways.join(', ')}) without public pricing table.`,
          payload: {
            domain: item.domain,
            fetchTier,
            stage,
            plans,
            gateways,
          },
          observedAt: ctx.clock(),
        });
      }

      const rawContent = JSON.stringify({
        domain: item.domain,
        url: item.targetUrl,
        fetchTier,
        plans,
        gateways,
        stage,
      });

      return {
        status: 'OK',
        snapshots,
        evidence,
        raw: {
          content: rawContent,
          contentHash: createHash('sha256').update(rawContent).digest('hex'),
          mimeType: 'application/json',
        },
        cost: {
          sourceId: this.sourceId,
          opportunityId: item.opportunityId,
          costUsd: totalCost,
          category: 'CRAWL',
          units: 1,
        },
      };
    } catch (err: any) {
      return {
        status: 'FAILED',
        retryable: true,
        errorCode: 'CRAWL_FETCH_ERROR',
        message: err.message,
      };
    }
  }

  private async checkRobotsTxt(domain: string, targetUrl: string): Promise<boolean> {
    try {
      const robotsUrl = `https://${domain}/robots.txt`;
      const res = await fetch(await this.assertPublicUrl(robotsUrl), { redirect: 'manual', headers: { 'User-Agent': 'EmeradarBot/1.0 (+https://emeradar.com/bot; compliance@emeradar.com)' }, signal: AbortSignal.timeout(2000) });

      if (!res.ok) return true; // Default allow if 404 or unavailable

      const text = await res.text();
      const lines = text.split('\n');
      let appliesToUs = false;

      for (const line of lines) {
        const trimmed = line.trim().toLowerCase();
        if (trimmed.startsWith('user-agent:')) {
          const agent = trimmed.replace('user-agent:', '').trim();
          appliesToUs = agent === '*' || agent === 'emeradarbot';
        } else if (appliesToUs && trimmed.startsWith('disallow:')) {
          const path = trimmed.replace('disallow:', '').trim();
          if (path === '/' || (path && targetUrl.includes(path))) {
            return false;
          }
        }
      }
      return true;
    } catch {
      return true; // Allow by default on connection failure to robots.txt
    }
  }

  private async fetchStaticHtml(url: string): Promise<string> {
    const lowerUrl = url.toLowerCase();
    if (process.env.NODE_ENV !== 'production' && (
      lowerUrl.includes('.test') ||
      lowerUrl.includes('.example') ||
      lowerUrl.includes('.local') ||
      lowerUrl.includes('synthetic')
    )) {
      return this.generateSyntheticHtml(url);
    }

    try {
      return await this.fetchPublicHtml(url);
    } catch (err) {
      throw err;
    }
  }

  private isDynamicPricingShell(html: string): boolean {
    const lower = html.toLowerCase();
    const hasSpaRoot =
      lower.includes('id="root"') ||
      lower.includes('id="__next"') ||
      lower.includes('id="app"') ||
      lower.includes('data-reactroot');
    const hasStripeScript =
      lower.includes('stripe-pricing-table') ||
      lower.includes('js.stripe.com') ||
      lower.includes('paddle.js');

    return hasSpaRoot || hasStripeScript;
  }

  private async renderHeadless(url: string): Promise<string | null> {
    const lowerUrl = url.toLowerCase();
    if (process.env.NODE_ENV !== 'production' && (
      lowerUrl.includes('.test') ||
      lowerUrl.includes('.example') ||
      lowerUrl.includes('.local') ||
      lowerUrl.includes('synthetic')
    )) {
      return `
        <html>
          <body>
            <div id="__next">
              <div class="pricing-card">
                <h3>Hobby</h3>
                <div class="price">$19/mo</div>
                <p>For independent developers</p>
              </div>
              <div class="pricing-card">
                <h3>Pro</h3>
                <div class="price">$49/mo</div>
                <p>For growing micro-saas teams</p>
              </div>
              <script src="https://js.stripe.com/v3/pricing-table.js"></script>
            </div>
          </body>
        </html>
      `;
    }

    // If external headless API is available, call it; otherwise inject rendered markup
    const browserlessKey = process.env.BROWSERLESS_API_KEY;
    if (browserlessKey) {
      try {
        const endpoint = `https://chrome.browserless.io/content?token=${browserlessKey}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          return await res.text();
        }
      } catch {
        // Fall through
      }
    }

    return null;
  }

  extractPricingPlans(html: string): PricingPlan[] {
    const plans: PricingPlan[] = [];
    const lower = html.toLowerCase();

    // Standard pattern matching for plan names and prices
    const planNames = ['Starter', 'Hobby', 'Basic', 'Pro', 'Growth', 'Business', 'Team', 'Enterprise'];
    const priceRegex = /(?:(\$|€|£)\s*(\d+(?:\.\d{2})?)\s*(?:\/|\s*per\s*)?(mo|month|yr|year)?)/gi;

    for (const name of planNames) {
      const idx = lower.indexOf(name.toLowerCase());
      if (idx !== -1) {
        // Look within 300 characters around plan name
        const snippet = html.slice(Math.max(0, idx - 50), Math.min(html.length, idx + 250));
        priceRegex.lastIndex = 0;
        const match = priceRegex.exec(snippet);
        if (match) {
          const currency = match[1] ?? '$';
          const price = parseFloat(match[2]);
          const period = match[3]?.toLowerCase();

          plans.push({
            name,
            currency,
            priceMonthly: period && period.startsWith('y') ? Math.round(price / 12) : price,
            priceYearly: period && period.startsWith('y') ? price : price * 10,
          });
        }
      }
    }

    return plans;
  }

  detectPaymentGateways(html: string): string[] {
    const gateways: string[] = [];
    const lower = html.toLowerCase();

    if (
      lower.includes('stripe.com') ||
      lower.includes('stripe-pricing-table') ||
      lower.includes('checkout.stripe.com') ||
      lower.includes('js.stripe.com')
    ) {
      gateways.push('Stripe');
    }
    if (lower.includes('paypal.com') || lower.includes('paypalobjects.com')) {
      gateways.push('PayPal');
    }
    if (lower.includes('paddle.com') || lower.includes('cdn.paddle.com')) {
      gateways.push('Paddle');
    }
    if (lower.includes('lemonsqueezy.com')) {
      gateways.push('LemonSqueezy');
    }
    if (lower.includes('shopify.com')) {
      gateways.push('Shopify');
    }

    return Array.from(new Set(gateways));
  }

  private generateSyntheticHtml(url: string): string {
    const u = url.toLowerCase();
    if (u.includes('spa') || u.includes('react') || u.includes('headless')) {
      return `
        <html>
          <body>
            <div id="__next">
              <stripe-pricing-table pricing-table-id="prctbl_123" publishable-key="pk_test_123"></stripe-pricing-table>
              <script src="https://js.stripe.com/v3/pricing-table.js"></script>
            </div>
          </body>
        </html>
      `;
    }

    return `
      <html>
        <head><title>Pricing - Tool</title></head>
        <body>
          <header><h1>Simple transparent pricing</h1></header>
          <div class="pricing-tier">
            <h2>Starter</h2>
            <div class="price">$15/mo</div>
            <p>1,000 runs per month</p>
          </div>
          <div class="pricing-tier">
            <h2>Pro</h2>
            <div class="price">$39/mo</div>
            <p>Unlimited runs</p>
          </div>
          <footer>
            <a href="https://checkout.stripe.com/c/pay/cs_live_123">Checkout via Stripe</a>
          </footer>
        </body>
      </html>
    `;
  }
}
