import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: [
    '@emeradar/core',
    '@emeradar/db',
    '@emeradar/scoring',
    '@emeradar/ledger',
    '@emeradar/report',
    '@emeradar/services',
  ],
  // nodemailer（SMTP 通道）只该在 Node 运行时里被 require，不要被 Next 打进
  // server bundle：它的传输实现按运行期环境挑模块，打包器静态分析不出来的部分
  // 会在 standalone 产物里变成运行期才发现的缺失。
  serverExternalPackages: ['nodemailer'],
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
};

export default nextConfig;
