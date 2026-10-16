import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page in this app is per-user and request-time, so Cache Components'
  // static-shell prerendering buys nothing. See DECISIONS.md.
  cacheComponents: false,
  // Native/wasm and worker-based packages must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pdf-parse", "pdfjs-dist", "@napi-rs/canvas", "mammoth"],
  experimental: {
    // Resume uploads go through a Server Action (default limit 1 MB).
    serverActions: { bodySizeLimit: "5mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
