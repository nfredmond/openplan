#!/usr/bin/env node

import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_LOCAL_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const OPTIONAL_LOCAL_ENV_KEYS = ["SUPABASE_DB_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"];
const SECRET_KEY_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|URL)$/i;
const LOCAL_URL_KEYS = new Set(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_DB_URL"]);
const LOCAL_HOST_PATTERN = /(?:^|@|\/\/)(127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i;

function usage() {
  return [
    "OpenPlan local Supabase status check",
    "",
    "Usage:",
    "  pnpm ops:check-local-supabase-status",
    "  pnpm ops:check-local-supabase-status -- --env-file .env.local --json",
    "",
    "Options:",
    "  --env-file <path>       Local env file to inspect; defaults to .env.local",
    "  --migrations-dir <path> Supabase migrations directory; defaults to supabase/migrations",
    "  --json                  Emit machine-readable summary",
    "  --help                 Show this help",
    "",
    "This is a read-only operator preflight. It never connects to Supabase and never prints secret values.",
  ].join("\n");
}

export function parseArgs(argv) {
  const args = {
    envFile: ".env.local",
    migrationsDir: "supabase/migrations",
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
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export function parseEnv(content) {
  const values = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [rawKey, ...rawValueParts] = line.split("=");
    const key = rawKey.trim().replace(/^export\s+/, "");
    let value = rawValueParts.join("=").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function redactStatus(key, value) {
  if (!value) return "missing";
  if (SECRET_KEY_PATTERN.test(key)) return "set-redacted";
  return "set";
}

export function classifyLocalUrl(key, value) {
  if (!LOCAL_URL_KEYS.has(key)) return null;
  if (!value) return "unset";
  return LOCAL_HOST_PATTERN.test(value) ? "local" : "non-local";
}

function decorateEnvItem(key, value) {
  const item = { key, status: redactStatus(key, value) };
  const localUrl = classifyLocalUrl(key, value);
  if (localUrl !== null) item.localUrl = localUrl;
  return item;
}

export async function inspectEnvFile(envFile) {
  const resolved = path.resolve(envFile || ".env.local");
  try {
    await access(resolved);
  } catch {
    return {
      file: resolved,
      exists: false,
      required: REQUIRED_LOCAL_ENV_KEYS.map((key) => decorateEnvItem(key, undefined)),
      optional: OPTIONAL_LOCAL_ENV_KEYS.map((key) => decorateEnvItem(key, undefined)),
    };
  }

  const values = parseEnv(await readFile(resolved, "utf8"));
  return {
    file: resolved,
    exists: true,
    required: REQUIRED_LOCAL_ENV_KEYS.map((key) => decorateEnvItem(key, values.get(key))),
    optional: OPTIONAL_LOCAL_ENV_KEYS.map((key) => decorateEnvItem(key, values.get(key))),
  };
}

export async function inspectMigrations(migrationsDir) {
  const resolved = path.resolve(migrationsDir || "supabase/migrations");
  const entries = await readdir(resolved, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isFile() && /^\d{14}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const timestamps = migrations.map((name) => name.slice(0, 14));
  const duplicateTimestamps = [...new Set(timestamps.filter((stamp, index) => timestamps.indexOf(stamp) !== index))];

  return {
    dir: resolved,
    count: migrations.length,
    first: migrations[0] ?? null,
    latest: migrations.at(-1) ?? null,
    duplicateTimestamps,
    nonSqlFilesIgnored: entries.filter((entry) => entry.isFile() && !entry.name.endsWith(".sql")).map((entry) => entry.name).sort(),
  };
}

export async function buildStatus({ envFile = ".env.local", migrationsDir = "supabase/migrations" } = {}) {
  const [env, migrations] = await Promise.all([inspectEnvFile(envFile), inspectMigrations(migrationsDir)]);
  const missingRequired = env.required.filter((item) => item.status === "missing").map((item) => item.key);
  const nonLocalUrlKeys = [...env.required, ...env.optional]
    .filter((item) => item.localUrl === "non-local")
    .map((item) => item.key);
  const issues = [];
  if (!env.exists) issues.push(`env file not found: ${env.file}`);
  if (missingRequired.length) issues.push(`missing required local Supabase env keys: ${missingRequired.join(", ")}`);
  if (nonLocalUrlKeys.length) {
    issues.push(
      `local Supabase URL keys do not point at 127.0.0.1 or localhost: ${nonLocalUrlKeys.join(", ")} (refusing to assume local-only writes)`,
    );
  }
  if (migrations.count === 0) issues.push(`no migration files found in ${migrations.dir}`);
  if (migrations.duplicateTimestamps.length) issues.push(`duplicate migration timestamps: ${migrations.duplicateTimestamps.join(", ")}`);

  return {
    status: issues.length ? "attention" : "ok",
    env,
    migrations,
    issues,
  };
}

function formatStatus(summary) {
  const lines = [
    "OpenPlan local Supabase status (read-only)",
    `Status: ${summary.status.toUpperCase()}`,
    "",
    `Env file: ${summary.env.file} (${summary.env.exists ? "found" : "missing"})`,
    "Required keys:",
    ...summary.env.required.map((item) =>
      `  - ${item.key}: ${item.status}${item.localUrl ? ` [local-host: ${item.localUrl}]` : ""}`,
    ),
    "Optional keys:",
    ...summary.env.optional.map((item) =>
      `  - ${item.key}: ${item.status}${item.localUrl ? ` [local-host: ${item.localUrl}]` : ""}`,
    ),
    "",
    `Migrations: ${summary.migrations.count} SQL files in ${summary.migrations.dir}`,
    `  - first: ${summary.migrations.first ?? "<none>"}`,
    `  - latest: ${summary.migrations.latest ?? "<none>"}`,
    `  - duplicate timestamps: ${summary.migrations.duplicateTimestamps.length ? summary.migrations.duplicateTimestamps.join(", ") : "none"}`,
  ];
  if (summary.issues.length) {
    lines.push("", "Attention items:", ...summary.issues.map((issue) => `  - ${issue}`));
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const summary = await buildStatus(args);
  console.log(args.json ? JSON.stringify(summary, null, 2) : formatStatus(summary));
  if (summary.status !== "ok") process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
