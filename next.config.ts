import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localSecurityHeaders } from "./src/lib/agent-hub/security-headers";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: localSecurityHeaders(process.env.NODE_ENV === 'development') }];
  },
  devIndicators: false,
  output: "standalone",
  serverExternalPackages: ["esbuild"],
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  // User-selected workspaces, runtime data and verification artifacts are
  // supplied on the host. Never copy them into the deployable application.
  outputFileTracingExcludes: {
    "/*": ["./db/**/*", "./.env*", "./.verification/**/*", "./output/**/*", "./.agenthub/**/*", "./agenthub-computer/.venv/**/*", "./tmp/**/*"],
  },
  // Tests may run an isolated dev server alongside a live one; a per-instance
  // build dir (NEXT_DIST_DIR) keeps the two `.next` caches from clobbering each
  // other. Defaults to ".next" for normal dev/build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /* config options here */
  reactStrictMode: false,
  experimental: {
    agentUpgrade: "security",
  },
};

export default nextConfig;
