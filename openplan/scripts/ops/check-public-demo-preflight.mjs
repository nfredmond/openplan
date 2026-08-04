#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// No default origin: OpenPlan has no canonical hosted instance, so the origin
// under test always belongs to whoever runs this.
const REQUEST_TIMEOUT_MS = 10_000;
const EXPECTED_HEALTH_CACHE_CONTROL = "no-store, max-age=0";
const MAPBOX_PUBLIC_ENV_NAMES = ["NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "NEXT_PUBLIC_MAPBOX_TOKEN"];
const REQUIRED_MAPBOX_CSP_FRAGMENTS = [
  { label: "Mapbox API connect-src", fragment: "https://api.mapbox.com" },
  { label: "Mapbox events connect-src", fragment: "https://events.mapbox.com" },
  { label: "Mapbox tile host", fragment: "https://*.tiles.mapbox.com" },
  { label: "Mapbox image host", fragment: "https://*.mapbox.com" },
  { label: "Mapbox worker blob support", fragment: "worker-src 'self' blob:" },
];

function usage() {
  return [
    "OpenPlan public demo preflight",
    "",
    "Usage:",
    "  npm run ops:check-public-demo-preflight -- --origin https://<your-deployment>",
    "  npm run ops:check-public-demo-preflight -- --mapbox-env-file .env.local",
    "",
    "Environment:",
    "  OPENPLAN_PUBLIC_DEMO_ORIGIN  REQUIRED unless --origin or --skip-network is given —",
    "                               your own deployment's public origin.",
    "",
    "Options:",
    "  --origin <url>              Production/demo origin to check",
    "  --skip-network              Only run local configuration posture checks",
    "  --mapbox-env-file <path>    Inspect only NEXT_PUBLIC_MAPBOX_* values from a local env file",
    "  --require-mapbox-token      Fail when no public Mapbox token is visible locally",
    "",
    "This script does not accept cookies, auth headers, service-role keys, Vercel tokens, or Supabase tokens.",
    "Against public origins it only performs GET/HEAD requests and never prints token values.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    origin: process.env.OPENPLAN_PUBLIC_DEMO_ORIGIN ?? "",
    skipNetwork: false,
    mapboxEnvFile: "",
    requireMapboxToken: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--origin") {
      args.origin = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--skip-network") {
      args.skipNetwork = true;
      continue;
    }

    if (arg === "--mapbox-env-file") {
      args.mapboxEnvFile = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--require-mapbox-token") {
      args.requireMapboxToken = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function fail(message, details = []) {
  const suffix = details.length ? `\n${details.map((detail) => `  - ${detail}`).join("\n")}` : "";
  throw new Error(`${message}${suffix}`);
}

function parseOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("--origin must be a valid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    fail("--origin must use http or https");
  }

  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function pathUrl(origin, pathname) {
  return new URL(pathname, origin).toString();
}

function responseSummary(response) {
  const location = response.headers.get("location");
  return location ? `${response.status} ${response.statusText} location=${location}` : `${response.status} ${response.statusText}`;
}

async function request(url, init = {}) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "manual",
      signal: timeoutSignal,
      headers: {
        "user-agent": "openplan-public-demo-preflight/1.0",
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      fail(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`, [url]);
    }
    throw error;
  }
}

function assertStatus(response, method, pathname) {
  if (response.status !== 200) {
    fail(`${method} ${pathname} returned non-200 status`, [
      responseSummary(response),
    ]);
  }
}

function assertCacheDisabled(response, method, pathname) {
  const cacheControl = response.headers.get("cache-control");
  if (cacheControl !== EXPECTED_HEALTH_CACHE_CONTROL) {
    fail(`${method} ${pathname} returned unexpected Cache-Control`, [
      `expected: ${EXPECTED_HEALTH_CACHE_CONTROL}`,
      `actual: ${cacheControl ?? "<missing>"}`,
    ]);
  }
}

function assertHealthPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("GET /api/health returned an invalid JSON object");
  }

  const checks = payload.checks;
  const checkedAt = typeof payload.checkedAt === "string" ? Date.parse(payload.checkedAt) : NaN;
  const failures = [];

  if (payload.status !== "ok") failures.push(`status must be "ok"; got ${JSON.stringify(payload.status)}`);
  if (payload.service !== "openplan") failures.push(`service must be "openplan"; got ${JSON.stringify(payload.service)}`);
  if (!Number.isFinite(checkedAt)) failures.push("checkedAt must be an ISO timestamp string");
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
    failures.push("checks must be an object");
  } else {
    if (checks.app !== "ok") failures.push(`checks.app must be "ok"; got ${JSON.stringify(checks.app)}`);
    if (checks.database !== "not_checked") {
      failures.push(`checks.database must stay "not_checked"; got ${JSON.stringify(checks.database)}`);
    }
  }

  if (failures.length) {
    fail("GET /api/health returned an unexpected payload", failures);
  }
}

async function checkHealth(origin) {
  const healthPath = "/api/health";
  const getResponse = await request(pathUrl(origin, healthPath), { method: "GET" });
  assertStatus(getResponse, "GET", healthPath);
  assertCacheDisabled(getResponse, "GET", healthPath);
  assertHealthPayload(await getResponse.json());

  const headResponse = await request(pathUrl(origin, healthPath), { method: "HEAD" });
  assertStatus(headResponse, "HEAD", healthPath);
  assertCacheDisabled(headResponse, "HEAD", healthPath);

  return "GET/HEAD /api/health return the shallow no-store app health contract";
}

async function assertHtmlRouteMarkers(origin, pathname, routeLabel, requiredMarkers, forbiddenMarkers = []) {
  const response = await request(pathUrl(origin, pathname), { method: "GET" });
  assertStatus(response, "GET", pathname);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    fail(`GET ${pathname} must return HTML`, [`content-type=${contentType || "<missing>"}`]);
  }

  const html = await response.text();
  const missingMarkers = requiredMarkers.filter((marker) => !html.includes(marker));

  if (missingMarkers.length) {
    fail(`GET ${pathname} returned HTML without expected ${routeLabel} markers`, missingMarkers);
  }

  const forbiddenMatches = forbiddenMarkers.filter((marker) => html.includes(marker));
  if (forbiddenMatches.length) {
    fail(`GET ${pathname} returned HTML with forbidden ${routeLabel} copy`, forbiddenMatches);
  }
}

/**
 * What a deployed /examples page must still say about itself.
 *
 * Every marker below is text the CURRENT page renders — its own title, the
 * screening gate the run recorded, the worst validation number, the first
 * verbatim caveat, and the disclaimer that one snapshot is not a live status.
 * Together they are the page's honesty: soften any one of them and the evidence
 * catalog becomes a brochure.
 *
 * THESE MUST TRACK THE REAL PAGE. This list used to demand four strings that
 * had not existed in the product for months, and it looked healthy only because
 * its unit test served it a hand-written fixture containing exactly the strings
 * it asked for — a check that could never notice the page had moved. The test
 * now derives its fixture from the page's own source and asserts every marker
 * here appears there, so this list cannot drift again without failing.
 */
export const EXAMPLES_REQUIRED_MARKERS = [
  // The page's own title.
  "Evidence catalog: screening proof with caveats intact",
  // Provenance: one finished run shown as-is, not a live feed and not a montage.
  "One completed run, verbatim",
  // The screening gate exactly as the run recorded it.
  "internal prototype only",
  // The worst number, on the page rather than buried. Digits without the
  // percent sign: the source now derives the figure from
  // NEVADA_COUNTY_MAX_APE_PERCENT (a number) and renders `${…}%`, so the
  // digits are what both the source approximation and the live page contain.
  "237.62",
  // …and why that number disqualifies the run from outward modeling claims.
  "Above the 50% critical-facility threshold",
  // The first caveat, quoted verbatim from the validation artifact.
  "screening-grade only",
  // The page's promise about its own method.
  "Caveats are quoted verbatim from the validation artifact",
  // A snapshot is not a live status.
  "not a guarantee of current runtime state",
];

/**
 * Copy that would turn the evidence catalog back into an overclaim. "One live
 * run" is the specific softening this page already corrected (it shows one
 * COMPLETED run); the rest are forecast/production claims a screening-grade
 * artifact cannot support.
 */
export const EXAMPLES_FORBIDDEN_MARKERS = [
  "One live run, verbatim",
  "validated forecast",
  "production data seeded",
  "instant customer activation",
];

async function checkExamples(origin) {
  await assertHtmlRouteMarkers(
    origin,
    "/examples",
    "examples evidence-catalog",
    EXAMPLES_REQUIRED_MARKERS,
    EXAMPLES_FORBIDDEN_MARKERS,
  );

  return "GET /examples returns the evidence catalog with its screening gate, worst-case validation number, and verbatim caveats intact";
}

async function checkMapboxCsp(origin) {
  const rootPath = "/";
  let method = "HEAD";
  let response = await request(pathUrl(origin, rootPath), { method: "HEAD" });
  if (response.status === 405) {
    method = "GET";
    response = await request(pathUrl(origin, rootPath), { method: "GET" });
  }

  assertStatus(response, method, rootPath);

  const csp = response.headers.get("content-security-policy") ?? "";
  if (!csp) {
    fail("Public origin is missing a Content-Security-Policy header for Mapbox posture checks");
  }

  const normalizedCsp = csp.toLowerCase();
  const missingFragments = REQUIRED_MAPBOX_CSP_FRAGMENTS
    .filter(({ fragment }) => !normalizedCsp.includes(fragment.toLowerCase()))
    .map(({ label, fragment }) => `${label}: missing ${fragment}`);

  if (missingFragments.length) {
    fail("Content-Security-Policy is missing Mapbox allowances required by demo map surfaces", missingFragments);
  }

  return "CSP includes Mapbox API, events, tile/image, and worker allowances";
}

function unquoteEnvValue(rawValue) {
  let value = rawValue.trim();
  for (const quote of ['"', "'"]) {
    if (value.startsWith(quote) && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1).trim();
    }
  }
  return value;
}

function parsePublicMapboxEnvFile(contents) {
  const values = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN|NEXT_PUBLIC_MAPBOX_TOKEN)\s*=\s*(.*)$/);
    if (!match) continue;

    values.push({
      name: match[1],
      value: unquoteEnvValue(match[2] ?? ""),
    });
  }
  return values;
}

async function loadMapboxEnvFile(filePath) {
  if (!filePath) return [];

  const resolved = path.resolve(process.cwd(), filePath);
  let contents;
  try {
    contents = await readFile(resolved, "utf8");
  } catch (error) {
    fail("--mapbox-env-file could not be read", [
      resolved,
      error instanceof Error ? error.message : String(error),
    ]);
  }

  return parsePublicMapboxEnvFile(contents).map((entry) => ({
    ...entry,
    source: `env file ${resolved}`,
  }));
}

async function checkMapboxPublicTokenPosture(args) {
  const envEntries = MAPBOX_PUBLIC_ENV_NAMES
    .map((name) => ({ name, value: process.env[name]?.trim() ?? "", source: "process environment" }))
    .filter((entry) => entry.value);
  const fileEntries = await loadMapboxEnvFile(args.mapboxEnvFile);
  const entries = [...envEntries, ...fileEntries].filter((entry) => entry.value);

  if (!entries.length) {
    if (args.requireMapboxToken) {
      fail("No public Mapbox token is visible in the process environment or selected env file");
    }

    return {
      checks: [],
      warnings: [
        "No NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN or NEXT_PUBLIC_MAPBOX_TOKEN value was visible locally; production token value was not inspected.",
      ],
    };
  }

  const invalidEntries = entries.filter((entry) => !entry.value.startsWith("pk."));
  if (invalidEntries.length) {
    fail(
      "Mapbox public token posture failed",
      invalidEntries.map((entry) => `${entry.name} from ${entry.source} is set but is not a public pk.* token; value was not printed.`),
    );
  }

  const names = [...new Set(entries.map((entry) => entry.name))].join(", ");
  return {
    checks: [`Mapbox public token format is pk.* for ${names}; token values were not printed`],
    warnings: [],
  };
}

export function formatResult(result) {
  if (result.help) {
    return result.text;
  }

  const status = result.warnings.length ? "passed with warnings" : "passed";
  const lines = [
    `OpenPlan public demo preflight ${status}.`,
    `origin=${result.origin}`,
    "",
    "Checks:",
  ];

  for (const check of result.checks) {
    lines.push(`  PASS ${check}`);
  }
  for (const warning of result.warnings) {
    lines.push(`  WARN ${warning}`);
  }

  lines.push(
    "",
    "Limitations:",
    "  - Only anonymous GET/HEAD requests were made; nothing behind sign-in was exercised.",
    "  - Supabase writes and outbound email were not attempted.",
    "  - Token values are never printed.",
  );

  return lines.join("\n");
}

export async function runPreflight(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    return { help: true, text: usage() };
  }

  const origin = parseOrigin(args.origin);
  const checks = [];
  const warnings = [];
  const mapboxTokenPosture = await checkMapboxPublicTokenPosture(args);
  checks.push(...mapboxTokenPosture.checks);
  warnings.push(...mapboxTokenPosture.warnings);

  if (args.skipNetwork) {
    warnings.push("network checks skipped by --skip-network");
  } else {
    checks.push(await checkHealth(origin));
    checks.push(await checkExamples(origin));
    checks.push(await checkMapboxCsp(origin));
  }

  return {
    origin: origin.toString(),
    checks,
    warnings,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await runPreflight(argv);
    console.log(formatResult(result));
  } catch (error) {
    console.error(`OpenPlan public demo preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && /^Unknown argument:/.test(error.message)) {
      console.error("");
      console.error(usage());
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
