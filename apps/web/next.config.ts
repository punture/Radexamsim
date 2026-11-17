import type { NextConfig } from "next";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
const WS = process.env.NEXT_PUBLIC_API_WS_URL ?? "ws://localhost:4000";

/** The site's public host when it is not localhost, for example a GitHub Codespaces forwarded address. */
const publicHost = (() => {
  try {
    return process.env.PUBLIC_WEB_ORIGIN ? new URL(process.env.PUBLIC_WEB_ORIGIN).hostname : undefined;
  } catch {
    return undefined;
  }
})();

/**
 * The browser talks to the API through same-origin rewrites (/api/*), so session cookies
 * stay first-party. The live examination WebSocket uses a single-use ticket and connects
 * either to the API origin or to /ws on this origin, which this server forwards to the API.
 * Workspace packages are transpiled; server-only packages (db, ai, clinical-content,
 * fixtures) must never be imported here (checked by scripts/check-client-bundle-leaks.mjs).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "media-src 'self' blob:",
      `connect-src 'self' ${WS} ${WS.replace(/^ws/, "http")}`,
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@sim/contracts", "@sim/viewer", "@sim/ui"],
  poweredByHeader: false,
  // Development only: the dev server refuses its own resources (/_next/*, hot reload) to pages
  // served from other hosts. Allow the site's public host (PUBLIC_WEB_ORIGIN).
  allowedDevOrigins: publicHost ? [publicHost] : [],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      // WebSocket upgrades are forwarded too, so PUBLIC_API_WS_URL may be this site's own origin
      // (wss://<site>/ws) and the API needs no public address of its own.
      { source: "/ws", destination: `${API}/ws` },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
