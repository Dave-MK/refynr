import type { NextConfig } from "next";

import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // ESLint isn't configured in this project; type-checking (tsc) is the build
  // gate. Skip lint during `next build` so it's deterministic on Vercel.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
