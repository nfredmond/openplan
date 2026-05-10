#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ORIGIN = "https://openplan-natford.vercel.app";
const REVIEWER_EMAIL_ENV = "OPENPLAN_ADMIN_OPERATIONS_SMOKE_REVIEWER_EMAIL";
const REVIEW_ALLOWLIST_ENV = "OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS";
const REQUEST_TIMEOUT_MS = 10_000;
const NON_MUTATING_ACCESS_REQUEST_ID = "44444444-4444-4444-8444-444444444444";

function usage() {
  return [
    "OpenPlan admin operations authenticated-smoke preflight",
    "",
    "Usage:",
    "  pnpm ops:check-admin-operations-smoke -- --reviewer-email <allowlisted-email>",
    "  pnpm ops:check-admin-operations-smoke -- --origin https://openplan-natford.vercel.app --reviewer-email <allowlisted-email>",
    "",
    "Options:",
    "  --reviewer-email <email>    Required allowlisted reviewer for the manual authenticated smoke",
    "  --origin <url>              Admin Operations origin to check",
    "  --skip-network              Only run local reviewer/allowlist posture checks; still requires --reviewer-email",
    "",
    "Environment:",
    `  OPENPLAN_ADMIN_OPERATIONS_SMOKE_REVIEWER_EMAIL  Optional default for --reviewer-email`,
    `  OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS          Optional local allowlist check; values are not printed`,
    "",
    "This script does not accept cookies, auth headers, service-role keys, Vercel tokens, or Supabase tokens.",
    "It only performs public/unauthenticated network checks and prints the manual browser smoke checklist.",
  ].join("\n");
}

export function parseArgs(argv) {
  const args = {
    origin: DEFAULT_ORIGIN,
    reviewerEmail: process.env[REVIEWER_EMAIL_ENV] ?? "",
    skipNetwork: false,
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

    if (arg === "--reviewer-email") {
      args.reviewerEmail = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--skip-network") {
      args.skipNetwork = true;
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

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function parseReviewerAllowlist(value) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => normalizeEmail(email))
      .filter(Boolean),
  );
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return "<invalid>";
  return `${local.slice(0, 1)}***@${domain}`;
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

function pathUrl(origin, path) {
  return new URL(path, origin).toString();
}

function responseSummary(response) {
  const location = response.headers.get("location");
  return location ? `${response.status} ${response.statusText} location=${location}` : `${response.status} ${response.statusText}`;
}

async function request(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "user-agent": "openplan-admin-operations-smoke-preflight/1.0",
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      fail(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`, [url]);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkHealth(origin) {
  const response = await request(pathUrl(origin, "/api/health"));
  if (response.status !== 200) {
    fail("GET /api/health must return 200 before admin smoke", [responseSummary(response)]);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    fail("GET /api/health must return JSON");
  }

  if (payload?.status !== "ok" || payload?.service !== "openplan" || payload?.checks?.app !== "ok") {
    fail("GET /api/health returned an unexpected payload", [JSON.stringify(payload)]);
  }

  return "GET /api/health returned 200 with status=ok";
}

async function checkRequestAccess(origin) {
  const response = await request(pathUrl(origin, "/request-access"));
  if (response.status !== 200) {
    fail("GET /request-access must be publicly reachable before reviewer smoke", [responseSummary(response)]);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    fail("GET /request-access must return an HTML page", [`content-type=${contentType || "<missing>"}`]);
  }

  return "GET /request-access returned 200 HTML";
}

function isAdminRedirectLocation(location) {
  if (!location) return false;
  const decoded = decodeURIComponent(location);
  return decoded.includes("/sign-in") && decoded.includes("/admin/operations");
}

async function checkAdminRedirect(origin) {
  const response = await request(pathUrl(origin, "/admin/operations"));
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    fail("Unauthenticated GET /admin/operations must redirect to sign-in", [responseSummary(response)]);
  }

  const location = response.headers.get("location");
  if (!isAdminRedirectLocation(location)) {
    fail("Unauthenticated GET /admin/operations redirected somewhere unexpected", [
      `location=${location ?? "<missing>"}`,
    ]);
  }

  return "Unauthenticated GET /admin/operations redirects to sign-in with the admin path preserved";
}

async function checkAdminApiDenial(origin) {
  const response = await request(pathUrl(origin, `/api/admin/access-requests/${NON_MUTATING_ACCESS_REQUEST_ID}`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "reviewing" }),
  });

  if (response.status !== 401) {
    fail("Unauthenticated POST /api/admin/access-requests/<uuid> must stop at 401", [responseSummary(response)]);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    fail("Unauthenticated admin API denial must come from the Next.js route JSON response");
  }

  if (payload?.error !== "Unauthorized") {
    fail("Unauthenticated admin API denial returned an unexpected payload", [JSON.stringify(payload)]);
  }

  return "Unauthenticated admin API triage request returns 401 before service-role access";
}

function checkReviewerPrerequisites(reviewerEmail) {
  const normalizedReviewer = normalizeEmail(reviewerEmail);
  if (!normalizedReviewer) {
    fail("--reviewer-email is required for a reproducible authenticated smoke");
  }

  if (!isLikelyEmail(normalizedReviewer)) {
    fail("--reviewer-email must look like an email address");
  }

  const allowlistValue = process.env[REVIEW_ALLOWLIST_ENV];
  if (!allowlistValue) {
    return {
      reviewer: normalizedReviewer,
      allowlistMessage:
        `${REVIEW_ALLOWLIST_ENV} is not present in this shell; verify the Vercel Production env var separately.`,
      allowlistWarning: true,
    };
  }

  const allowlist = parseReviewerAllowlist(allowlistValue);
  if (!allowlist.has(normalizedReviewer)) {
    fail(`${REVIEW_ALLOWLIST_ENV} is present in this shell but does not contain the reviewer email`, [
      "The value was not printed.",
    ]);
  }

  return {
    reviewer: normalizedReviewer,
    allowlistMessage: `${REVIEW_ALLOWLIST_ENV} is present locally and contains the reviewer email.`,
    allowlistWarning: false,
  };
}

export function formatResult(result) {
  const status = result.warnings.length ? "passed with warnings" : "passed";
  const lines = [
    `OpenPlan admin operations smoke preflight ${status}.`,
    `origin=${result.origin}`,
    `reviewer=${maskEmail(result.reviewer)}`,
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
    "Manual authenticated smoke:",
    "  1. In a normal browser, sign in manually as the allowlisted reviewer.",
    `  2. Open ${pathUrl(result.origin, "/admin/operations")}.`,
    "  3. Confirm the page renders Warning watchboard, Recent supervised onboarding requests, and Assistant action activity.",
    "  4. Confirm the access-request lane is not locked for the reviewer.",
    "  5. Do not click triage buttons, create workspaces, send email, or record prospect PII unless separately approved.",
  );

  return lines.join("\n");
}

export async function runPreflight(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    return { help: true, text: usage() };
  }

  const origin = parseOrigin(args.origin);
  const reviewerCheck = checkReviewerPrerequisites(args.reviewerEmail);
  const checks = [
    `reviewer email accepted (${maskEmail(reviewerCheck.reviewer)})`,
  ];
  const warnings = [];

  if (reviewerCheck.allowlistWarning) {
    warnings.push(reviewerCheck.allowlistMessage);
  } else {
    checks.push(reviewerCheck.allowlistMessage);
  }

  if (args.skipNetwork) {
    warnings.push("network checks skipped by --skip-network");
  } else {
    checks.push(await checkHealth(origin));
    checks.push(await checkRequestAccess(origin));
    checks.push(await checkAdminRedirect(origin));
    checks.push(await checkAdminApiDenial(origin));
  }

  return {
    origin: origin.toString(),
    reviewer: reviewerCheck.reviewer,
    checks,
    warnings,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await runPreflight(argv);
    console.log(result.help ? result.text : formatResult(result));
  } catch (error) {
    console.error(`OpenPlan admin operations smoke preflight failed: ${error instanceof Error ? error.message : String(error)}`);
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
