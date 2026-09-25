import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import pkg from "./package.json";

// Settings → About shows the version and the commit a build came from, so any
// deployment can be traced back to its source (as the macOS app does).
const commit = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
})();

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version, NEXT_PUBLIC_APP_COMMIT: commit },
};

export default nextConfig;
