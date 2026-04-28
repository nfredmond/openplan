#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_HEALTH_URL = "https://openplan-natford.vercel.app/api/health";
const REQUEST_TIMEOUT_MS = 10_000;
const EXPECTED_CACHE_CONTROL = "no-store, max-age=0";

function usage() {
  return [
    "OpenPlan production health check",
    "",
    "Usage:",
    "  pnpm ops:check-prod-health",
    "",
    "Environment:",
    `  OPENPLAN_HEALTH_URL  Defaults to ${DEFAULT_HEALTH_URL}`,
  ].join("\n");
}

function fail(message, details = []) {
  const suffix = details.length ? `\n${details.map((detail) => `  - ${detail}`).join("\n")}` : "";
  throw new Error(`${message}${suffix}`);
}

function assertCacheDisabled(response, method) {
  const cacheControl = response.headers.get("cache-control");
  if (cacheControl !== EXPECTED_CACHE_CONTROL) {
    fail(`${method} /api/health returned unexpected Cache-Control`, [
      `expected: ${EXPECTED_CACHE_CONTROL}`,
      `actual: ${cacheControl ?? "<missing>"}`,
    ]);
  }
}

function assertStatus(response, method) {
  if (response.status !== 200) {
    fail(`${method} /api/health returned non-200 status`, [
      `status: ${response.status}`,
      `statusText: ${response.statusText || "<empty>"}`,
    ]);
  }
}

function assertPayload(payload) {
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
    if (checks.billing !== "not_checked") {
      failures.push(`checks.billing must stay "not_checked"; got ${JSON.stringify(checks.billing)}`);
    }
  }

  if (failures.length) {
    fail("GET /api/health returned an unexpected payload", failures);
  }
}

async function request(url, method) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return fetch(url, {
    method,
    cache: "no-store",
    redirect: "manual",
    signal: timeoutSignal,
    headers: {
      "user-agent": "openplan-prod-health-check/1.0",
    },
  });
}

async function check(url) {
  const getResponse = await request(url, "GET");
  assertStatus(getResponse, "GET");
  assertCacheDisabled(getResponse, "GET");
  assertPayload(await getResponse.json());

  const headResponse = await request(url, "HEAD");
  assertStatus(headResponse, "HEAD");
  assertCacheDisabled(headResponse, "HEAD");

  return {
    url,
    checkedAt: new Date().toISOString(),
  };
}

export async function runHealthCheck(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true, text: usage() };
  }

  const url = (process.env.OPENPLAN_HEALTH_URL || DEFAULT_HEALTH_URL).trim();
  if (!url) {
    fail("OPENPLAN_HEALTH_URL cannot be empty");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    fail("OPENPLAN_HEALTH_URL must be a valid URL");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    fail("OPENPLAN_HEALTH_URL must use http or https");
  }

  return check(parsedUrl.toString());
}

export function formatResult(result) {
  if (result.help) {
    return result.text;
  }

  return [
    `OpenPlan health check passed: ${result.url}`,
    `checkedAt=${result.checkedAt}`,
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await runHealthCheck(argv);
    console.log(formatResult(result));
  } catch (error) {
    console.error(`OpenPlan health check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
