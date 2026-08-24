import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // The import route reads uploaded CSV bytes in full to checksum them.
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
