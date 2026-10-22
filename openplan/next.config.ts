import type { NextConfig } from "next";
import { readdirSync } from "node:fs";
import path from "node:path";
import { migrationVersionsFromFilenames } from "./src/lib/ops/migration-manifest";

// Every migration this build expects, read once from the repository at build
// time and inlined for the health routes. A build without the directory (a
// copied bundle, for example) records none and the routes say so.
const BUILD_MIGRATION_VERSIONS = (() => {
  try {
    return migrationVersionsFromFilenames(readdirSync(path.join(__dirname, "supabase", "migrations"))).join(",");
  } catch {
    return "";
  }
})();

const LOCAL_DEV_CONNECT_SRC =
  process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*"];

// The browser may reach the configured Supabase project and no other. A
// wildcard such as *.supabase.co would let injected script send data to any
// project on that platform. Local and self-hosted stacks work the same way.
const SUPABASE_ORIGIN = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return [];
  try {
    return [new URL(raw).origin];
  } catch {
    return [];
  }
})();

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

// A map without a Mapbox key loads the operator's MapLibre style, and its
// tiles, glyphs and sprites, from wherever that style says. Its origin is
// allowed here, plus any extra origins the operator lists for tiles or fonts
// served from elsewhere. A same-origin style (fully local) needs neither.
const OPEN_MAP_SRC = (() => {
  const origins = new Set<string>();
  const add = (raw: string | undefined) => {
    const value = raw?.trim();
    if (!value || value.startsWith("/")) return;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") origins.add(url.origin);
    } catch {
      // Not a URL; the map treats it as unset too.
    }
  };
  add(process.env.NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL);
  for (const extra of (process.env.OPENPLAN_MAP_EXTRA_ORIGINS ?? "").split(",")) add(extra);
  return [...origins];
})();

// The CSP differs on exactly ONE directive between normal pages and embeddable
// widgets: frame-ancestors. Normal pages forbid all framing ('none'); the
// (embed)/* segment allows any site to frame it ('*') so agencies can iframe a
// campaign on their own site. Everything else — script/connect/img/object-src —
// is identical, so build both from one function to prevent drift.
function buildCsp(frameAncestors: string, scriptSrc = "script-src 'self' 'unsafe-inline' 'unsafe-eval'"): string {
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' data: blob: https://*.mapbox.com https://*.tiles.mapbox.com", ...SUPABASE_ORIGIN, ...OPEN_MAP_SRC].join(" "),
    [
      "connect-src 'self'",
      ...SUPABASE_CONNECT_SRC,
      ...LOCAL_DEV_CONNECT_SRC,
      "https://api.mapbox.com",
      "https://events.mapbox.com",
      "https://*.tiles.mapbox.com",
      ...OPEN_MAP_SRC,
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

// The enforced policy still allows 'unsafe-eval'. Production Next.js does not
// need it, and neither Mapbox GL nor MapLibre documents it, but no browser
// journey has proved every map and library works without it. Browsers report,
// without blocking, what this candidate would refuse; once /api/csp-report
// stays quiet through a release, the candidate can replace the enforced
// policy. Development keeps eval because React's refresh runtime uses it.
const CANDIDATE_SCRIPT_SRC =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
const CSP_REPORT_ONLY_POLICY = buildCsp("'none'", CANDIDATE_SCRIPT_SRC);
const EMBED_CSP_REPORT_ONLY_POLICY = buildCsp("*", CANDIDATE_SCRIPT_SRC);

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
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY_POLICY },
];

const EMBED_SECURITY_HEADERS = [
  ...COMMON_SECURITY_HEADERS,
  // No X-Frame-Options — framing is governed solely by the relaxed CSP below.
  { key: "Content-Security-Policy", value: EMBED_CSP_POLICY },
  { key: "Content-Security-Policy-Report-Only", value: EMBED_CSP_REPORT_ONLY_POLICY },
];

const nextConfig: NextConfig = {
  // No "X-Powered-By: Next.js" on responses; it names the framework to scanners.
  poweredByHeader: false,
  env: {
    OPENPLAN_BUILD_MIGRATION_VERSIONS: BUILD_MIGRATION_VERSIONS,
  },
  // Reduce webpack's peak build memory on the standard 8 GB hosted builder.
  // Keep the normal type check and the existing webpack build path.
  experimental: {
    webpackMemoryOptimizations: true,
  },
  // Published evidence lives beside the application package. Trace from the
  // repository root and retain the frozen studies and fixed disclosure metadata.
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/models": [
      "../scripts/modeling/development/california_distributed_work_loading_study.v1.json",
      "../data/modeling/distributed-work-loading-study-2026-08-31/**/*",
      "../data/modeling/comparable-observation-study-2026-08-28/**/*",
      "../data/modeling/structural-demand-diagnosis-study-2026-08-28/**/*",
      "../data/modeling/model-validation-structural-diagnosis-2026-08-28/**/*",
    ],
    "/models/*": [
      "../scripts/modeling/development/california_distributed_work_loading_study.v1.json",
    ],
    "/api/models/distributed-work-loading/*": [
      "../scripts/modeling/development/california_distributed_work_loading_study.v1.json",
      "../data/modeling/distributed-work-loading-study-2026-08-31/**/*",
    ],
    "/api/models/comparable-observation-study/*": [
      "../data/modeling/comparable-observation-study-2026-08-28/**/*",
    ],
    "/api/models/structural-demand-diagnosis/*": [
      "../data/modeling/structural-demand-diagnosis-study-2026-08-28/**/*",
    ],
    "/api/models/validation-structural-diagnosis/*": [
      "../data/modeling/model-validation-structural-diagnosis-2026-08-28/**/*",
    ],
  },
  // Heavy, Node-only document parsers used by the Knowledge Base extraction path
  // (src/lib/knowledge-base/extract.ts). Keep them external so the webpack server
  // build require()s them at runtime instead of bundling pdf.js / mammoth internals.
  // puppeteer-core and @sparticuz/chromium are dynamically imported by
  // src/lib/reports/pdf.ts. Listing them keeps webpack from tracing Chromium
  // (~57MB) into every function that can reach the renderer — three of them
  // now — against Vercel's 250MB limit.
  serverExternalPackages: ["unpdf", "mammoth", "puppeteer-core", "@sparticuz/chromium"],
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
