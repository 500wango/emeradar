import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { CommercialStage, isPrivateAddress, readBodyWithLimit } from '@emeradar/core';
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
  billingPeriod?: 'monthly' | 'yearly' | 'unknown';
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
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
      throw new Error('Target URL must resolve to a public host');
    }
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error('Target URL must resolve to a public address');
    }
    return parsed;
  }

  private async fetchPublicHtml(url: string, maxRedirects = 3): Promise<string> {
    const parsed = await this.assertPublicUrl(url);
    const res = await fetch(parsed, { redirect: 'manual', headers: { 'User-Agent': 'EmeradarBot/1.0 (+https://emeradar.com/bot; compliance@emeradar.com)', Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(10_000) });
    if (res.status >= 300 && res.status < 400) {
      if (maxRedirects === 0) throw new Error('Too many redirects');
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect missing location');
      return this.fetchPublicHtml(new URL(location, parsed).toString(), maxRedirects - 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return readBodyWithLimit(res);
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

  /**
   * 从首页找 pricing/plans/billing 链接，减少盲猜 `/pricing` 造成的 404。
   * 找不到或首页不可读时回退 `/pricing`；这里只做一次静态首页读取，不递归爬站。
   */
  async discoverPricingUrl(domain: string): Promise<string> {
    const fallback = `https://${domain}/pricing`;
    try {
      const html = await this.fetchPublicHtml(`https://${domain}/`);
      const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      let best: { url: string; score: number } | null = null;
      for (const match of links) {
        const href = match[1];
        const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        let url: URL;
        try {
          url = new URL(href, `https://${domain}/`);
        } catch {
          continue;
        }
        if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) continue;
        if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
        const path = url.pathname.toLowerCase();
        let score = 0;
        if (/pricing|price/.test(path)) score += 4;
        if (/plans?|billing|upgrade|subscribe/.test(path)) score += 2;
        if (/pricing|price|plan|billing|upgrade/.test(text)) score += 2;
        if (score <= 0) continue;
        if (!best || score > best.score) best = { url: url.toString(), score };
      }
      return best?.url ?? fallback;
    } catch {
      return fallback;
    }
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
      // If 0 plans detected and dynamic SPA shell detected, upgrade to Tier 2 Headless.
      // `dynamicShell` is kept on the snapshot: an empty Tier-1 read on such a page means
      // "cannot conclude", not "no pricing" (07 §11.1).
      const dynamicShell = plans.length === 0 && this.isDynamicPricingShell(html);
      if (dynamicShell) {
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
            dynamicShell,
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
          // 07 §3: an observable price is a paid tier; a gateway alone only proves
          // the ability to charge, and must never be counted as commercial proof.
          sourceType: plans.length > 0 ? 'PAID_TIER_OBSERVED' : 'PAYMENT_INFRA_DETECTED',
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

      const text = await readBodyWithLimit(res, 256 * 1024);
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
      lower.includes('data-reactroot') ||
      lower.includes('id="__nuxt"') ||
      lower.includes('ng-version') ||
      lower.includes('__sveltekit') ||
      lower.includes('astro-island') ||
      lower.includes('vite/client');
    const hasStripeScript =
      lower.includes('stripe-pricing-table') ||
      lower.includes('js.stripe.com') ||
      lower.includes('paddle.js');

    if (hasSpaRoot || hasStripeScript) return true;
    // 没有典型 SPA 根节点、但脚本多且可见文字很少：大概率是前端渲染。
    const scriptCount = (lower.match(/<script\b/g) || []).length;
    const visibleText = lower.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return scriptCount >= 4 && visibleText.length < 800;
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
          return await readBodyWithLimit(res);
        }
      } catch {
        // Fall through
      }
    }

    const aisaKey = process.env.AISA_API_KEY;
    if (aisaKey) {
      // Firecrawl 抓取会渲染页面，适合 SPA/动态定价页；比 Tavily extract 更接近
      // 浏览器里的文字。失败再回退 Tavily extract。
      try {
        const res = await fetch('https://api.aisa.one/apis/v1/firecrawl/scrape', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aisaKey}`,
          },
          body: JSON.stringify({ url, proxy: 'basic', formats: ['markdown'] }),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) {
          const data = await res.json();
          const markdown = data?.data?.markdown;
          if (typeof markdown === 'string' && markdown.length > 50) return markdown;
        }
      } catch {
        // Fall through to Tavily extract
      }

      try {
        const endpoint = 'https://api.aisa.one/apis/v1/tavily/extract';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aisaKey}`,
          },
          body: JSON.stringify({ urls: [url] }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const data = await res.json();
          const raw = data.results?.[0]?.raw_content;
          if (typeof raw === 'string' && raw.length > 50) {
            return raw;
          }
        }
      } catch {
        // Fall through
      }
    }

    return null;
  }

  extractPricingPlans(html: string): PricingPlan[] {
    const plans: PricingPlan[] = [];
    const seen = new Set<string>();
    const add = (plan: PricingPlan) => {
      const key = `${plan.name}|${plan.priceMonthly ?? ''}|${plan.priceYearly ?? ''}|${plan.currency}`;
      if (seen.has(key)) return;
      seen.add(key);
      plans.push(plan);
    };

    const decoded = html
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#36;|&dollar;/gi, '$')
      .replace(/&#8364;|&euro;/gi, '€')
      .replace(/&#163;|&pound;/gi, '£')
      .replace(/&amp;/gi, '&');

    // 1) JSON-LD Product/Offer：很多现代站点只在这里写价格。
    for (const match of decoded.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const data = JSON.parse(match[1]);
        const visit = (node: any) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) {
            node.forEach(visit);
            return;
          }
          const type = String(node['@type'] ?? '').toLowerCase();
          const offer = node.price ?? node.priceSpecification?.price;
          if (offer !== undefined && (type.includes('offer') || type.includes('product') || type.includes('service') || node.priceCurrency)) {
            const price = Number(String(offer).replace(/[^0-9.]/g, ''));
            if (Number.isFinite(price) && price > 0) {
              const currency = String(node.priceCurrency ?? node.priceSpecification?.priceCurrency ?? 'USD').toUpperCase();
              const name = String(node.itemOffered?.name ?? node.name ?? 'Listed plan').slice(0, 80);
              const period = String(node.priceSpecification?.billingDuration ?? node.billingPeriod ?? '').toLowerCase();
              const yearly = period.includes('year') || period.includes('annual') || period.includes('p1y');
              add({
                name,
                currency: currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency,
                priceMonthly: yearly ? Math.round(price / 12) : price,
                priceYearly: yearly ? price : price * 10,
                billingPeriod: yearly ? 'yearly' : 'monthly',
              });
            }
          }
          Object.values(node).forEach(visit);
        };
        visit(data);
      } catch {
        // 坏 JSON-LD 不影响后续 HTML 解析
      }
    }

    // 2) Meta price（部分独立站只暴露 product/og price）
    for (const match of decoded.matchAll(/<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([^"']+)["']/gi)) {
      const price = Number(match[1].replace(/[^0-9.]/g, ''));
      if (Number.isFinite(price) && price > 0) {
        add({ name: 'Listed plan', currency: '$', priceMonthly: price, priceYearly: price * 10, billingPeriod: 'monthly' });
      }
    }

    // 3) 可见文本：计划名附近找价格；不再要求必须在固定的 8 个名字里。
    const visible = decoded
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const lower = visible.toLowerCase();

    const planNames = [
      'Free', 'Starter', 'Hobby', 'Basic', 'Solo', 'Pro', 'Professional', 'Growth',
      'Business', 'Team', 'Scale', 'Plus', 'Premium', 'Enterprise', 'Agency',
    ];

    // 金额解析。
    //  - "8,99"（欧陆写法）是 8.99，不是 899；
    //  - "1,299"（英语写法）是 1299，不是 1.299；
    //  - "8.99" 原样。
    // 判据只看小数点后是否恰好两位。
    const parseAmount = (raw: string): number => {
      const cleaned = raw.trim();
      if (/,\d{2}$/.test(cleaned)) return Number(cleaned.replace(/\./g, '').replace(',', '.'));
      return Number(cleaned.replace(/,/g, ''));
    };

    const readPrice = (windowText: string): { price: number; currency: string; period: string } | null => {
      // 四个分支：$金额 / €金额 / £金额 / 金额+货币词。
      // **货币必须由「命中了哪个分支」决定**，不能从捕获的金额里取——这里曾经写成
      // `currency = match[1]`，而 match[1] 是金额，于是界面渲染出 "8.998.99"。
      // 金额 token 必须容纳千分位（1,299）与两位小数（8.99 / 8,99）：
      // 旧写法 `\d{1,5}(?:[.,]\d{1,2})?` 会把 "1,299" 截成 "1,29"。
      const AMOUNT = '(\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d{1,2})?)';
      const pricePattern = new RegExp(
        `(?:US)?\\$\\s*${AMOUNT}|€\\s*${AMOUNT}|£\\s*${AMOUNT}|${AMOUNT}\\s*(USD|EUR|GBP|\\$|€|£)`,
        'i'
      );
      const match = pricePattern.exec(windowText);
      if (!match) return null;

      let currency: string;
      let raw: string;
      if (match[1]) {
        currency = '$';
        raw = match[1];
      } else if (match[2]) {
        currency = '€';
        raw = match[2];
      } else if (match[3]) {
        currency = '£';
        raw = match[3];
      } else {
        raw = match[4];
        const token = (match[5] ?? '').toUpperCase();
        currency = token === 'EUR' || token === '€' ? '€' : token === 'GBP' || token === '£' ? '£' : '$';
      }

      const price = parseAmount(raw);
      if (!Number.isFinite(price) || price <= 0) return null;
      const after = windowText.slice(match.index, match.index + 80);
      const periodMatch = /(\/\s*(?:mo|month)|per\s+month|monthly|\/\s*(?:yr|year)|per\s+year|annual|yearly)/i.exec(after);
      const period = periodMatch ? (/yr|year|annual/i.test(periodMatch[0]) ? 'yearly' : 'monthly') : 'unknown';
      return { price, currency, period };
    };

    for (const name of planNames) {
      const re = new RegExp(`\\b${name.toLowerCase()}\\b`, 'gi');
      let match: RegExpExecArray | null;
      while ((match = re.exec(lower)) !== null) {
        const windowText = lower.slice(match.index, match.index + 260);
        const price = readPrice(windowText);
        if (!price) continue;
        add({
          name,
          currency: price.currency,
          priceMonthly: price.period === 'yearly' ? Math.round(price.price / 12) : price.price,
          priceYearly: price.period === 'yearly' ? price.price : price.price * 10,
          billingPeriod: price.period === 'unknown' ? 'unknown' : price.period === 'yearly' ? 'yearly' : 'monthly',
        });
      }
    }

    // 4) 没有可识别计划名，但页面有明确“pricing/per month”价格：至少保留一条可观察价格。
    if (plans.length === 0 && /pricing|per month|\/mo|monthly/i.test(visible)) {
      const price = readPrice(lower);
      if (price) {
        add({
          name: 'Listed plan',
          currency: price.currency,
          priceMonthly: price.period === 'yearly' ? Math.round(price.price / 12) : price.price,
          priceYearly: price.period === 'yearly' ? price.price : price.price * 10,
          billingPeriod: price.period === 'unknown' ? 'unknown' : price.period === 'yearly' ? 'yearly' : 'monthly',
        });
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
