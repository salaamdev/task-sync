import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Silence the "multiple lockfiles" warning
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),

  webpack: (config) => {
    const alias = config.resolve.alias as Record<string, string | string[]>;
    alias['@core'] = path.resolve(process.cwd(), '..', 'dist');
    return config;
  },
};

export default nextConfig;
