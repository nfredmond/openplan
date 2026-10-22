#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

// Three serial server probes each allow eight seconds, plus response overhead.
const REQUEST_TIMEOUT_MS = 30_000;
const MANAGEMENT_API = "https://api.supabase.com";

function usage() {
  return [
    "OpenPlan deep health and migration check",
    "",
    "Usage:",
    "  OPENPLAN_HEALTH_URL=https://<deployment>/api/health \\",
    "  OPENPLAN_HEALTH_TOKEN=... SUPABASE_ACCESS_TOKEN=... OPENPLAN_SUPABASE_PROJECT_REF=<ref> \\",
    "  npm run ops:check-deep-health",
    "",
    "Environment:",
    "  OPENPLAN_HEALTH_URL            REQUIRED. The deployment's public /api/health URL.",
    "  OPENPLAN_HEALTH_TOKEN          Same value as the deployment's OPENPLAN_HEALTH_TOKEN.",
    "                                 Turns on the database, Storage and heartbeat check.",
    "  OPENPLAN_SUPABASE_PROJECT_REF  The hosted Supabase project ref. Turns on the",
    "                                 migration check; then both tokens are required.",
    "  SUPABASE_ACCESS_TOKEN          A Supabase personal access token, used read-only",
    "                                 to list the project's applied migrations.",
    "",
    "With neither OPENPLAN_HEALTH_TOKEN nor OPENPLAN_SUPABASE_PROJECT_REF set, the",
    "check is off and says so. It never applies a migration.",
  ].join("\n");
}

function fail(message, details = []) {
  const suffix = details.length ? `\n${details.map((detail) => `  - ${detail}`).join("\n")}` : "";
  throw new Error(`${message}${suffix}`);
}

function env(name) {
  return (process.env[name] ?? "").trim();
}

/**
 * Expected versions the database lacks, and applied versions the build does
 * not include. Hosted migrations may be applied out of numeric order, so this
 * compares whole sets. Only `missing` fails: the deployed code may read schema
 * that is not there. `extra` is normal while a migration is applied ahead of
 * the code that uses it.
 */
export function compareMigrationSets(expected, applied) {
  const appliedSet = new Set(applied);
  const expectedSet = new Set(expected);
  return {
    missing: [...expectedSet].filter((version) => !appliedSet.has(version)).sort(),
    extra: [...appliedSet].filter((version) => !expectedSet.has(version)).sort(),
  };
}

export function deepHealthUrl(healthUrl) {
  const url = new URL(healthUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/deep`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function request(url, headers) {
  return fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "user-agent": "openplan-deep-health-check/1.0", ...headers },
  });
}

async function readDeepHealth(url, token) {
  const response = await request(url, { authorization: `Bearer ${token}` });
  if (response.status === 404) {
    fail("Deep health is off on the deployment.", [
      "Set OPENPLAN_HEALTH_TOKEN in the deployment's environment to the same value as this check's secret, then redeploy.",
    ]);
  }
  if (response.status === 401) {
    fail("The deployment refused the deep health token.", [
      "OPENPLAN_HEALTH_TOKEN differs between the deployment and this check.",
    ]);
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    fail(`Deep health returned HTTP ${response.status} without a JSON body.`);
  }
  if (!payload || typeof payload !== "object" || payload.service !== "openplan") {
    fail(`Deep health returned HTTP ${response.status} with an unexpected body.`);
  }
  const failed = [];
  for (const name of ["database", "storage"]) {
    if (payload.checks?.[name]?.state !== "ok") failed.push(`${name} check: ${payload.checks?.[name]?.state ?? "missing"}`);
  }
  if (response.status !== 200 || payload.status !== "ok" || failed.length) {
    fail(`The deployment cannot reach part of its backend (HTTP ${response.status}).`, failed.length ? failed : [`status: ${payload.status}`]);
  }
  return payload;
}

async function readAppliedMigrations(projectRef, accessToken) {
  const url = `${MANAGEMENT_API}/v1/projects/${encodeURIComponent(projectRef)}/database/migrations`;
  const response = await request(url, { authorization: `Bearer ${accessToken}` });
  if (response.status === 401 || response.status === 403) {
    fail(`Supabase refused SUPABASE_ACCESS_TOKEN for project ${projectRef} (HTTP ${response.status}).`, [
      "Create a new personal access token in the Supabase dashboard and replace the repository secret.",
    ]);
  }
  if (response.status !== 200) {
    fail(`Supabase could not list the applied migrations for project ${projectRef} (HTTP ${response.status}).`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.some((row) => typeof row?.version !== "string")) {
    fail("Supabase returned a migration list in an unexpected shape.");
  }
  return rows.map((row) => row.version);
}

export async function runDeepHealthCheck(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true, text: usage() };
  }

  const healthUrl = env("OPENPLAN_HEALTH_URL");
  const healthToken = env("OPENPLAN_HEALTH_TOKEN");
  const projectRef = env("OPENPLAN_SUPABASE_PROJECT_REF");
  const accessToken = env("SUPABASE_ACCESS_TOKEN");

  if (!healthToken && !projectRef) {
    return {
      off: true,
      text: [
        "Deep health and migration check: off.",
        "Nothing compares the migrations this deployment expects with the ones its database has.",
        "To turn it on, set OPENPLAN_HEALTH_TOKEN (deployment and check), OPENPLAN_SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN.",
      ].join("\n"),
    };
  }

  if (!healthUrl) fail("OPENPLAN_HEALTH_URL is required: set it to your deployment's /api/health URL.");
  let parsed;
  try {
    parsed = new URL(healthUrl);
  } catch {
    fail("OPENPLAN_HEALTH_URL must be a valid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) fail("OPENPLAN_HEALTH_URL must use http or https.");

  const missingSettings = [];
  if (!healthToken) missingSettings.push("OPENPLAN_HEALTH_TOKEN");
  if (projectRef && !accessToken) missingSettings.push("SUPABASE_ACCESS_TOKEN");
  if (missingSettings.length) {
    fail("The migration check is turned on but not fully configured.", missingSettings.map((name) => `${name} is not set`));
  }
  if (projectRef && !/^[a-z0-9]{20}$/.test(projectRef)) {
    fail("OPENPLAN_SUPABASE_PROJECT_REF must be a 20-character Supabase project ref.");
  }

  const deep = await readDeepHealth(deepHealthUrl(parsed.toString()), healthToken);
  const commit = typeof deep.deployment?.commit === "string" ? deep.deployment.commit : "unknown";
  const workers = Array.isArray(deep.checks?.modelingWorkers) ? deep.checks.modelingWorkers : [];
  const result = { url: parsed.toString(), commit, workers, migrations: null };

  if (!projectRef) return result;

  const expected = deep.migrations?.expected?.versions;
  if (!Array.isArray(expected) || expected.length === 0) {
    fail(`The deployment (commit ${commit}) does not report which migrations it expects.`, [
      "It was built without openplan/supabase/migrations, or before this check existed.",
    ]);
  }
  const applied = await readAppliedMigrations(projectRef, accessToken);
  const { missing, extra } = compareMigrationSets(expected, applied);
  if (missing.length) {
    fail(
      `The deployed code (commit ${commit}) expects ${missing.length} migration${missing.length === 1 ? "" : "s"} the database has not applied. Pages that read the new schema will fail until they are applied.`,
      [
        ...missing.map((version) => `missing: ${version} (openplan/supabase/migrations/${version}_*.sql)`),
        "Apply them to the hosted project, or roll the app back to a build that does not need them (openplan/docs/ops/HOSTED_OPERATIONS.md).",
      ],
    );
  }
  result.migrations = { expected: expected.length, applied: applied.length, extra };
  return result;
}

export function formatResult(result) {
  if (result.help || result.off) return result.text;
  const lines = [`OpenPlan deep health passed: deployment commit ${result.commit}`];
  for (const worker of result.workers) {
    const age = worker.ageSeconds === null || worker.ageSeconds === undefined ? "no heartbeat" : `${worker.ageSeconds}s ago`;
    lines.push(`modeling worker ${worker.kind}: last heartbeat ${age}${worker.fresh ? "" : " (stale)"}`);
  }
  if (result.migrations) {
    lines.push(
      `Migrations: the database has all ${result.migrations.expected} the deployed code expects (${result.migrations.applied} applied in total).`,
    );
    if (result.migrations.extra.length) {
      lines.push(
        `Applied ahead of this build, not an error: ${result.migrations.extra.join(", ")}`,
      );
    }
  } else {
    lines.push("Migration check: off (OPENPLAN_SUPABASE_PROJECT_REF is not set).");
  }
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await runDeepHealthCheck(argv);
    if (result.off && process.env.GITHUB_ACTIONS === "true") {
      console.log("::notice title=Migration check off::Set OPENPLAN_HEALTH_TOKEN, OPENPLAN_SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN to compare deployed and applied migrations.");
    }
    console.log(formatResult(result));
  } catch (error) {
    console.error(`OpenPlan deep health check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
