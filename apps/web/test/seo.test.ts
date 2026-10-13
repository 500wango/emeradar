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
  isPrivatePath,
  organizationJsonLd,
  pageMetadata,
  publicOpportunityPath,
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
  });
  assert.equal(metadata.openGraph?.url, `${SITE_URL}/pricing`);
  assert.equal(metadata.openGraph && 'locale' in metadata.openGraph ? metadata.openGraph.locale : undefined, 'zh_CN');
  assert.equal(metadata.twitter && 'card' in metadata.twitter ? metadata.twitter.card : undefined, 'summary');

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
  // 没有位图 logo 就不填 logo：结构化数据里编造或指错资源会让整块数据失去意义。
  assert.equal('logo' in organization, false);

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
