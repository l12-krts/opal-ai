import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy. Next.js needs inline scripts for hydration; nonce-based CSP can
// replace 'unsafe-inline' later once every page renders dynamically.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "media-src 'self' blob: data:",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  // The Docker image (deploy/umbrel/web.Dockerfile) ships Next's self-contained server.
  output: process.env.OPAL_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
  reactStrictMode: true,
  // Native / Node-only packages stay out of the bundler.
  serverExternalPackages: ["dockerode", "ssh2", "cpu-features", "sharp", "pg", "unpdf", "duck-duck-scrape"],
  experimental: {
    // Every request passes through proxy.ts, which cuts bodies at 10 MB by default. Uploads
    // allow up to 20 MB (chat attachments) and enforce their own limits per route.
    proxyClientMaxBodySize: "21mb",
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API responses are never cached by browsers or proxies.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
