import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Produced alongside the normal build, so `next start` and `npm run launch`
  // are unaffected. The container image runs `.next/standalone/server.js`.
  output: "standalone",
};

export default nextConfig;
