#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildStatus as buildLocalSupabaseStatus } from "./check-local-supabase-status.mjs";
import { buildMigrationInventory } from "./check-migration-inventory.mjs";
import { runHealthCheck } from "./check-prod-health.mjs";

const execFile = promisify(execFileCallback);

const DEFAULT_HEALTH_URL = "https://openplan-natford.vercel.app/api/health";
const DEFAULT_DEPLOYMENT_TARGET = "https://openplan-natford.vercel.app";
const DEFAULT_VERCEL_COMMAND = "vercel";
const DEFAULT_VERCEL_SCOPE = "natford";
const DEFAULT_TIMEOUT_MS = 15_000;
const READY_STATES = new Set(["READY"]);
const JSON_CONTRACT_VERSION = "pilot-preflight.v1";
const SAFETY_CAVEATS = Object.freeze([
  "Read-only preflight only; this command does not insert, update, delete, or upsert application data.",
  "No production writes; this command does not create pilot workspaces, support intake rows, billing records, comments, reports, or smoke-test artifacts.",
  "No schema apply; this command does not run supabase db push, migration up, db reset, SQL migrations, or equivalent schema-changing operations.",
  "No secret values; env keys are reported as present/missing/local/non-local only, and Vercel output is normalized to status fields.",
  "No evidence-file writes; JSON mode emits the contract to stdout for the caller to capture if desired.",
]);

function buildSafetyContract(options = {}) {
  return {
    readOnly: true,
    secretSafe: true,
    noProductionWrites: true,
    noSchemaApply: true,
    noSecretValues: true,
    noEvidenceFileWrites: true,
    stdoutOnly: true,
    externalReads: {
      productionHealth: !options.skipHealth,
      vercelInspect: !options.skipVercel,
    },
    caveats: [...SAFETY_CAVEATS],
  };
}

function usage() {
  return [
    "OpenPlan pilot-readiness preflight bundle",
    "",
    "Usage:",
    "  pnpm ops:check-pilot-preflight",
    "  pnpm ops:check-pilot-preflight -- --env-file .env.local --migrations-dir supabase/migrations --json",
    "",
    "Options:",
    "  --env-file <path>          Local env file to inspect; defaults to .env.local",
    "  --migrations-dir <path>    Supabase migrations directory; defaults to supabase/migrations",
    "  --health-url <url>         Production health URL; defaults to canonical production /api/health",
    "  --deployment-target <url>  Vercel deployment or alias to inspect; defaults to canonical production alias",
    "  --vercel-command <path>    Vercel CLI command path; defaults to vercel",
    "  --vercel-scope <scope>      Vercel team/user scope for inspect; defaults to natford",
    "  --skip-health              Skip the live production health fetch",
    "  --skip-vercel              Skip the read-only Vercel deployment inspection",
    "  --json                     Emit machine-readable summary",
    "  --help                     Show this help",
    "",
    "This command is read-only. It does not apply migrations, mutate Supabase/Vercel, print secret values,",
    "or write production data. Vercel output is normalized to deployment status fields only.",
  ].join("\n");
}

export function parseArgs(argv) {
  const args = {
    envFile: ".env.local",
    migrationsDir: "supabase/migrations",
    healthUrl: process.env.OPENPLAN_HEALTH_URL || DEFAULT_HEALTH_URL,
    deploymentTarget: process.env.OPENPLAN_DEPLOYMENT_TARGET || DEFAULT_DEPLOYMENT_TARGET,
    vercelCommand: process.env.OPENPLAN_VERCEL_COMMAND || DEFAULT_VERCEL_COMMAND,
    vercelScope: process.env.OPENPLAN_VERCEL_SCOPE || DEFAULT_VERCEL_SCOPE,
    skipHealth: false,
    skipVercel: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--skip-health") {
      args.skipHealth = true;
      continue;
    }
    if (arg === "--skip-vercel") {
      args.skipVercel = true;
      continue;
    }
    if (arg === "--env-file") {
      args.envFile = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--migrations-dir") {
      args.migrationsDir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--health-url") {
      args.healthUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--deployment-target") {
      args.deploymentTarget = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--vercel-command") {
      args.vercelCommand = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--vercel-scope") {
      args.vercelScope = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function normalizeUrl(value, label) {
  if (!value || typeof value !== "string") throw new Error(`${label} cannot be empty`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`${label} must use http or https`);
  return parsed.toString();
}

function sanitizeErrorMessage(error) {
  if (!error) return "unknown error";
  if (error.code === "ENOENT") return "vercel CLI not found on PATH";
  if (typeof error.code === "string" || typeof error.code === "number") return `vercel CLI exited with code ${error.code}`;
  return error instanceof Error ? error.message.split("\n")[0] : String(error).split("\n")[0];
}

function normalizeVercelInspectPayload(payload, target) {
  const readyState = payload?.readyState ?? payload?.state ?? payload?.deployment?.readyState ?? null;
  const deploymentUrl = payload?.url ?? payload?.deployment?.url ?? target;
  const normalizedUrl = typeof deploymentUrl === "string" && deploymentUrl && !/^https?:\/\//i.test(deploymentUrl)
    ? `https://${deploymentUrl}`
    : deploymentUrl;
  const deploymentTarget = payload?.target ?? payload?.deployment?.target ?? payload?.environment ?? null;
  const id = payload?.id ?? payload?.uid ?? payload?.name ?? payload?.deployment?.id ?? payload?.deployment?.uid ?? null;
  const createdAt = payload?.createdAt ?? payload?.created ?? payload?.deployment?.createdAt ?? null;
  const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
  const commitSha = typeof meta.githubCommitSha === "string" ? meta.githubCommitSha : null;

  const issues = [];
  if (!readyState) issues.push("Vercel inspect did not return a readyState/state field");
  if (readyState && !READY_STATES.has(String(readyState).toUpperCase())) {
    issues.push(`Vercel deployment is not READY (readyState=${readyState})`);
  }

  return {
    status: issues.length ? "attention" : "ok",
    target,
    deploymentUrl: normalizedUrl,
    deploymentId: id,
    readyState,
    environment: deploymentTarget,
    createdAt,
    commitSha,
    inspectedAt: new Date().toISOString(),
    issues,
  };
}

export async function inspectVercelDeployment({ target = DEFAULT_DEPLOYMENT_TARGET, command = DEFAULT_VERCEL_COMMAND, scope = DEFAULT_VERCEL_SCOPE } = {}, deps = {}) {
  const normalizedTarget = normalizeUrl(target, "deployment target");
  const runner = deps.execFile ?? execFile;
  const args = ["inspect", normalizedTarget, "--json"];
  if (scope) args.push("--scope", scope);
  try {
    const { stdout } = await runner(command || DEFAULT_VERCEL_COMMAND, args, {
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const payload = JSON.parse(String(stdout || "{}"));
    return normalizeVercelInspectPayload(payload, normalizedTarget);
  } catch (error) {
    return {
      status: "attention",
      target: normalizedTarget,
      deploymentUrl: null,
      deploymentId: null,
      readyState: null,
      environment: null,
      createdAt: null,
      commitSha: null,
      inspectedAt: new Date().toISOString(),
      issues: [`read-only Vercel inspect unavailable: ${sanitizeErrorMessage(error)}`],
    };
  }
}

async function runHealthCheckForUrl(healthUrl) {
  const normalizedHealthUrl = normalizeUrl(healthUrl, "health URL");
  const previousHealthUrl = process.env.OPENPLAN_HEALTH_URL;
  process.env.OPENPLAN_HEALTH_URL = normalizedHealthUrl;
  try {
    const result = await runHealthCheck([]);
    return {
      status: "ok",
      url: result.url,
      checkedAt: result.checkedAt,
      issues: [],
    };
  } catch (error) {
    return {
      status: "attention",
      url: normalizedHealthUrl,
      checkedAt: new Date().toISOString(),
      issues: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    if (previousHealthUrl === undefined) delete process.env.OPENPLAN_HEALTH_URL;
    else process.env.OPENPLAN_HEALTH_URL = previousHealthUrl;
  }
}

function skippedSection(label) {
  return {
    status: "skipped",
    skipped: true,
    issues: [`${label} skipped by operator flag`],
  };
}

export async function buildPilotPreflight(options = {}, deps = {}) {
  const localSupabase = await buildLocalSupabaseStatus({
    envFile: options.envFile,
    migrationsDir: options.migrationsDir,
  });
  const migrationInventory = await buildMigrationInventory({ migrationsDir: options.migrationsDir });
  const productionHealth = options.skipHealth
    ? skippedSection("production health check")
    : await (deps.healthCheck ?? runHealthCheckForUrl)(options.healthUrl || DEFAULT_HEALTH_URL);
  const deploymentReadiness = options.skipVercel
    ? skippedSection("Vercel deployment inspection")
    : await (deps.vercelInspect ?? inspectVercelDeployment)(
        {
          target: options.deploymentTarget || DEFAULT_DEPLOYMENT_TARGET,
          command: options.vercelCommand || DEFAULT_VERCEL_COMMAND,
          scope: options.vercelScope || DEFAULT_VERCEL_SCOPE,
        },
        deps,
      );

  const sections = { localSupabase, migrationInventory, productionHealth, deploymentReadiness };
  const issues = [
    ...localSupabase.issues.map((issue) => `local Supabase: ${issue}`),
    ...migrationInventory.issues.map((issue) => `migration inventory: ${issue}`),
    ...productionHealth.issues.map((issue) => `production health: ${issue}`),
    ...deploymentReadiness.issues.map((issue) => `deployment readiness: ${issue}`),
  ];

  return {
    schemaVersion: JSON_CONTRACT_VERSION,
    command: "ops:check-pilot-preflight",
    status: issues.length ? "attention" : "ok",
    checkedAt: new Date().toISOString(),
    readOnly: true,
    secretSafe: true,
    safety: buildSafetyContract(options),
    sections,
    issues,
  };
}

function formatLocalSupabase(summary) {
  return [
    `  status: ${summary.status.toUpperCase()}`,
    `  env file: ${summary.env.file} (${summary.env.exists ? "found" : "missing"})`,
    `  required keys: ${summary.env.required.map((item) => `${item.key}=${item.status}${item.localUrl ? `/${item.localUrl}` : ""}`).join(", ")}`,
    `  optional keys: ${summary.env.optional.map((item) => `${item.key}=${item.status}${item.localUrl ? `/${item.localUrl}` : ""}`).join(", ")}`,
  ];
}

function formatMigrationInventory(summary) {
  return [
    `  status: ${summary.status.toUpperCase()}`,
    `  directory: ${summary.dir} (${summary.exists ? "found" : "missing"})`,
    `  migrations: ${summary.count} (${summary.totalSize ?? `${summary.totalBytes} B`})`,
    `  first/latest: ${summary.first ?? "<none>"} / ${summary.latest ?? "<none>"}`,
    `  review flags: ${summary.reviewFlags.length}`,
    `  duplicate timestamps/slugs: ${summary.duplicateTimestamps.length}/${summary.duplicateSlugs.length}`,
  ];
}

function formatProductionHealth(summary) {
  if (summary.skipped) return ["  status: SKIPPED", `  note: ${summary.issues[0]}`];
  return [
    `  status: ${summary.status.toUpperCase()}`,
    `  health URL: ${summary.url}`,
    `  checkedAt: ${summary.checkedAt}`,
  ];
}

function formatDeploymentReadiness(summary) {
  if (summary.skipped) return ["  status: SKIPPED", `  note: ${summary.issues[0]}`];
  return [
    `  status: ${summary.status.toUpperCase()}`,
    `  target: ${summary.target}`,
    `  readyState: ${summary.readyState ?? "<unknown>"}`,
    `  environment: ${summary.environment ?? "<unknown>"}`,
    `  deployment: ${summary.deploymentUrl ?? "<unknown>"}`,
    `  commit: ${summary.commitSha ?? "<unknown>"}`,
  ];
}

export function formatPreflight(summary) {
  const lines = [
    "OpenPlan pilot-readiness preflight bundle (read-only)",
    `Status: ${summary.status.toUpperCase()}`,
    `checkedAt=${summary.checkedAt}`,
    "",
    "Local Supabase status guard:",
    ...formatLocalSupabase(summary.sections.localSupabase),
    "",
    "Supabase migration inventory:",
    ...formatMigrationInventory(summary.sections.migrationInventory),
    "",
    "Production health:",
    ...formatProductionHealth(summary.sections.productionHealth),
    "",
    "Deployment readiness:",
    ...formatDeploymentReadiness(summary.sections.deploymentReadiness),
  ];

  if (summary.issues.length) {
    lines.push("", "Attention items:", ...summary.issues.map((issue) => `  - ${issue}`));
  }
  lines.push("", "Safety: read-only; no schema apply, production writes, secret values, or evidence-file writes emitted.");
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const summary = await buildPilotPreflight(args);
  console.log(args.json ? JSON.stringify(summary, null, 2) : formatPreflight(summary));
  if (summary.status !== "ok") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
