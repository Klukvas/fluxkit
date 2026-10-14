import type { NextConfig } from "next";

// Keep in sync with defaultLocale in @fluxkit/ui (this file runs in plain Node and cannot import the bundler-built package).
const DEFAULT_LOCALE = "uk";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/", destination: `/${DEFAULT_LOCALE}`, permanent: false }];
  },
};

export default nextConfig;
