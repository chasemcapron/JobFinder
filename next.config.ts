import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page in this app is per-user and request-time, so Cache Components'
  // static-shell prerendering buys nothing. See DECISIONS.md.
  cacheComponents: false,
  // Native/wasm and worker-based packages must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pdf-parse", "pdfjs-dist", "@napi-rs/canvas", "mammoth"],
  // pdf.js loads its worker with a computed dynamic import that file tracing can't see,
  // so Vercel would deploy the resume page without it.
  outputFileTracingIncludes: {
    "/resume": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  experimental: {
    // Resume uploads go through a Server Action (default limit 1 MB).
    serverActions: { bodySizeLimit: "5mb" },
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
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
