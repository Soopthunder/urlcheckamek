import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone = a self-contained server.js + minimal node_modules that Electron runs
  output: "standalone",
  // gzip buffers small chunks, which would freeze the agents' live stream; it's localhost anyway
  compress: false,
  // playwright-core loads its own files dynamically: keep it out of the bundle
  serverExternalPackages: ["playwright-core"],
  // playwright-core's (unused) Electron driver makes the tracer copy all of Electron (~370 MB)
  outputFileTracingExcludes: { "*": ["node_modules/electron/**"] },
};

export default nextConfig;
