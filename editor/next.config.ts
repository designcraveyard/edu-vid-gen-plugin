import type { NextConfig } from 'next';

const mediaPort = process.env.NEXT_PUBLIC_MEDIA_PORT || '3334';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  async rewrites() {
    return [
      {
        source: '/media/:path*',
        destination: `http://localhost:${mediaPort}/:path*`,
      },
    ];
  },
};

export default nextConfig;
