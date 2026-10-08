import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone = a self-contained server.js + minimal node_modules that Electron runs
  output: "standalone",
  // gzip buffers small chunks, which would freeze the agents' live stream; it's localhost anyway
  compress: false,
};

export default nextConfig;
