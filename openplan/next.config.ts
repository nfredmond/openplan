import type { NextConfig } from "next";

const LOCAL_DEV_CONNECT_SRC =
  process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*"];

// The configured Supabase instance must always be reachable from the browser —
// a production build serving a local/self-hosted stack (demo laptops,
// air-gapped deploys) is otherwise blocked by the *.supabase.co-only rule.
const SUPABASE_CONNECT_SRC = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return [];
  try {
    const url = new URL(raw);
    const ws = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
    return [url.origin, ws];
  } catch {
    return [];
  }
})();

// The CSP differs on exactly ONE directive between normal pages and embeddable
// widgets: frame-ancestors. Normal pages forbid all framing ('none'); the
// (embed)/* segment allows any site to frame it ('*') so agencies can iframe a
// campaign on their own site. Everything else — script/connect/img/object-src —
// is identical, so build both from one function to prevent drift.
function buildCsp(frameAncestors: string): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.mapbox.com https://*.tiles.mapbox.com https://*.supabase.co",
    [
      "connect-src 'self'",
      "https://*.supabase.co",
      "wss://*.supabase.co",
      ...SUPABASE_CONNECT_SRC,
      ...LOCAL_DEV_CONNECT_SRC,
      "https://api.mapbox.com",
      "https://events.mapbox.com",
      "https://*.tiles.mapbox.com",
    ].join(" "),
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    `frame-ancestors ${frameAncestors}`,
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

const CSP_POLICY = buildCsp("'none'");
const EMBED_CSP_POLICY = buildCsp("*");

const COMMON_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const SECURITY_HEADERS = [
  ...COMMON_SECURITY_HEADERS,
  // X-Frame-Options DENY belongs ONLY on non-embed pages. It has no "allow these
  // origins" value, so an embed that needs cross-origin framing must not send it
  // — CSP frame-ancestors is the scoped control there.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: CSP_POLICY },
];

const EMBED_SECURITY_HEADERS = [
  ...COMMON_SECURITY_HEADERS,
  // No X-Frame-Options — framing is governed solely by the relaxed CSP below.
  { key: "Content-Security-Policy", value: EMBED_CSP_POLICY },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Everything EXCEPT the embed segment. The negative lookahead makes the
        // two source blocks non-overlapping, so an embed path gets exactly ONE
        // CSP (the relaxed one) — never a second locked-down CSP that would then
        // re-forbid framing.
        source: "/((?!embed(?:/|$)).*)",
        headers: SECURITY_HEADERS,
      },
      {
        source: "/embed/:path*",
        headers: EMBED_SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
