import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  /**
   * Pin the workspace root to this directory.
   *
   * An `npm install` was once run in the home directory by mistake, leaving a
   * stray /Users/alaz/package-lock.json behind. Next.js sees multiple lockfiles,
   * picks the highest one as the root, and warns on every boot. Setting this
   * explicitly stops it guessing.
   */
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
