import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import {
  PRIVATE_PATH_PREFIXES,
  SITE_URL,
  STATIC_PUBLIC_PAGES,
  absoluteUrl,
  breadcrumbJsonLd,
  datasetJsonLd,
  faqPageJsonLd,
  isPrivatePath,
  organizationJsonLd,
  pageMetadata,
  publicOpportunityPath,
  softwareApplicationJsonLd,
  techArticleJsonLd,
  websiteJsonLd,
} from '../src/lib/seo/site';

test('私有路径用响应头声明 noindex，公开页不声明', () => {
  for (const path of ['/feed', '/alerts', '/projects/abc', '/settings', '/login', '/register', '/admin/users', '/opportunities/some-slug', '/billing', '/compare']) {
    const response = middleware(new NextRequest(`https://emeradar.com${path}`));
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', `${path} 应当是 noindex`);
  }

  // 公开档案与营销页必须保持可索引：'/opportunities/...' 的工作台是私有的，
  // '/public/opportunities/...' 是公开档案，前缀判断不能把它们混为一谈。
  for (const path of ['/', '/pricing', '/methodology', '/track-record', '/terms', '/public/opportunities/some-slug']) {
    const response = middleware(new NextRequest(`https://emeradar.com${path}`));
    assert.equal(response.headers.get('x-robots-tag'), null, `${path} 不应当被声明 noindex`);
  }

  assert.equal(isPrivatePath('/administrator'), false, '前缀匹配必须按路径段边界，不能是字符串包含');
  assert.equal(isPrivatePath('/public/opportunities/x'), false);
  assert.equal(isPrivatePath('/opportunities/x'), true);
});

test('公开页清单是站点地图与 metadata 的同一份事实', () => {
  const paths: string[] = STATIC_PUBLIC_PAGES.map((page) => page.path);
  assert.deepEqual(new Set(paths).size, paths.length, '公开页清单里不应有重复路径');
  assert.ok(paths.every((path) => path.startsWith('/')), '路径必须是站点内绝对路径');
  assert.equal(paths[0], '/', '首页要排在最前');
  assert.ok(paths.includes('/pricing'), '/pricing 是可索引的公开页，必须在清单里');
  assert.ok(
    paths.every((path) => !isPrivatePath(path)),
    '公开页清单与私有路径清单不能重叠'
  );
  assert.deepEqual(PRIVATE_PATH_PREFIXES.filter((prefix) => paths.includes(prefix)), []);
  // canonical 与站点地图共用同一个拼法：首页不带尾斜杠，其余保留路径。
  assert.equal(absoluteUrl('/'), SITE_URL);
  assert.equal(absoluteUrl('/pricing'), `${SITE_URL}/pricing`);
  assert.equal(publicOpportunityPath('demo'), '/public/opportunities/demo');
  assert.throws(() => absoluteUrl('pricing'), /必须以 \//);
});

test('页面 metadata 的 canonical、robots 与 Open Graph 来自同一个 path', () => {
  const metadata = pageMetadata({
    title: '价格方案：Free 与 Pro 对比',
    description: '对比 Free 与 Pro 的信息流延迟与额度。',
    path: '/pricing',
    locale: 'zh-CN',
  });
  assert.equal(metadata.alternates?.canonical, `${SITE_URL}/pricing`);
  assert.deepEqual(metadata.robots, {
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  });
  assert.equal(metadata.openGraph?.url, `${SITE_URL}/pricing`);
  assert.equal(metadata.openGraph && 'locale' in metadata.openGraph ? metadata.openGraph.locale : undefined, 'zh_CN');
  assert.equal(metadata.twitter && 'card' in metadata.twitter ? metadata.twitter.card : undefined, 'summary_large_image');
  assert.ok(Array.isArray(metadata.openGraph?.images) && metadata.openGraph.images.length > 0);
  assert.equal((metadata.openGraph.images[0] as any).url, `${SITE_URL}/og-image.png`);

  const hidden = pageMetadata({ title: 'x', description: 'y', path: '/pricing', locale: 'en-US', index: false });
  assert.deepEqual(hidden.robots, { index: false, follow: false });
  assert.equal(hidden.openGraph && 'locale' in hidden.openGraph ? hidden.openGraph.locale : undefined, 'en_US');
});

test('JSON-LD 只声明能背书的字段，面包屑每项都完整', () => {
  const site = websiteJsonLd();
  assert.equal(site['@type'], 'WebSite');
  assert.equal(site.url, `${SITE_URL}/`);

  const organization = organizationJsonLd();
  assert.equal(organization['@type'], 'Organization');
  assert.equal(organization['@context'], 'https://schema.org');
  // 已生成合规的 512x512 位图 logo，断言其指向确切的静态资源
  assert.equal(organization.logo, `${SITE_URL}/logo.png`);
  assert.equal(organization.image, `${SITE_URL}/og-image.png`);

  const app = softwareApplicationJsonLd();
  assert.equal(app['@type'], 'WebApplication');
  assert.equal(app.name, 'Emeradar');
  assert.ok(Array.isArray(app.offers) && app.offers.length >= 3);
  assert.ok(Array.isArray(app.featureList) && app.featureList.length >= 3);

  const faq = faqPageJsonLd([
    { question: 'What is Emeradar?', answer: 'Search signal intelligence engine.' },
  ]);
  assert.equal(faq['@type'], 'FAQPage');
  assert.equal(faq.mainEntity.length, 1);
  assert.equal(faq.mainEntity[0].name, 'What is Emeradar?');

  const tech = techArticleJsonLd({
    headline: 'Methodology: 3-Axis Evaluation',
    description: 'Demand, Commercial, and Window Gating.',
    path: '/methodology',
    locale: 'zh-CN',
    articleSection: ['Lifecycle', 'Gate'],
  });
  assert.equal(tech['@type'], 'TechArticle');
  assert.equal(tech.headline, 'Methodology: 3-Axis Evaluation');
  assert.equal(tech.url, `${SITE_URL}/methodology`);
  assert.equal(tech.inLanguage, 'zh-CN');

  const dataset = datasetJsonLd({
    name: 'Emeradar Ledger',
    description: 'Prediction dataset',
    path: '/track-record',
  });
  assert.equal(dataset['@type'], 'Dataset');
  assert.equal(dataset.name, 'Emeradar Ledger');
  assert.equal(dataset.url, `${SITE_URL}/track-record`);

  const crumbs = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Archived record', path: '/public/opportunities/demo' },
  ]);
  assert.equal(crumbs.itemListElement.length, 2);
  crumbs.itemListElement.forEach((item, index) => {
    assert.equal(item.position, index + 1);
    assert.ok(item.name.length > 0);
    assert.ok(item.item.startsWith(SITE_URL));
  });
});

test('robots.ts 符合规范：公开页放行、私有页阻断、声明 sitemap 与核心爬虫', async () => {
  const robotsModule = await import('../src/app/robots');
  const config = robotsModule.default();

  assert.equal(config.sitemap, `${SITE_URL}/sitemap.xml`);
  assert.ok(Array.isArray(config.rules) && config.rules.length >= 2);

  const starRule = config.rules[0];
  assert.equal(starRule.userAgent, '*');
  const allow = Array.isArray(starRule.allow) ? starRule.allow : [starRule.allow];
  const disallow = Array.isArray(starRule.disallow) ? starRule.disallow : [starRule.disallow];

  for (const page of STATIC_PUBLIC_PAGES) {
    assert.ok(allow.includes(page.path), `robots.txt 应当允许公开页：${page.path}`);
  }
  assert.ok(allow.includes('/public/opportunities/'), 'robots.txt 应当允许公开档案');
  assert.ok(allow.includes('/logo.png') && allow.includes('/og-image.png'), 'robots.txt 应当允许抓取图片资产');

  for (const priv of PRIVATE_PATH_PREFIXES) {
    assert.ok(disallow.some((d) => d && d.startsWith(priv)), `robots.txt 应当阻止私有路径：${priv}`);
  }
});

