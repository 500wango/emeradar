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
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
};

export default nextConfig;
