#!/usr/bin/env node

import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MIGRATIONS_DIR = "supabase/migrations";
const MIGRATION_FILENAME_PATTERN = /^(?<timestamp>\d{14})_(?<slug>[a-z0-9][a-z0-9_]*?)\.sql$/;
const REVIEW_PATTERNS = [
  { id: "security-definer", label: "SECURITY DEFINER function", pattern: /\bsecurity\s+definer\b/i },
  { id: "drop-statement", label: "DROP statement", pattern: /\bdrop\s+(table|view|function|policy|trigger|schema|extension|type|index)\b/i },
  { id: "truncate-statement", label: "TRUNCATE statement", pattern: /\btruncate\s+(table\s+)?[\w".]+/i },
  { id: "rls-policy", label: "RLS policy change", pattern: /\b(create|alter|drop)\s+policy\b/i },
  { id: "privilege-change", label: "Privilege change", pattern: /\b(grant|revoke|alter\s+default\s+privileges)\b/i },
  { id: "storage-policy", label: "Storage bucket or policy change", pattern: /\bstorage\.(buckets|objects)\b/i },
];

function usage() {
  return [
    "OpenPlan Supabase migration inventory check",
    "",
    "Usage:",
    "  pnpm ops:check-migration-inventory",
    "  pnpm ops:check-migration-inventory -- --migrations-dir supabase/migrations --json",
    "",
    "Options:",
    "  --migrations-dir <path>  Directory to inspect; defaults to supabase/migrations",
    "  --max-review <n>         Max review-flagged migrations to list in text output; defaults to 8",
    "  --fail-on-review         Exit non-zero when migrations contain operator-review patterns",
    "  --json                   Emit machine-readable summary",
    "  --help                  Show this help",
    "",
    "This is a read-only preflight. It never connects to Supabase and never applies migrations.",
  ].join("\n");
}

export function parseArgs(argv) {
  const args = {
    migrationsDir: DEFAULT_MIGRATIONS_DIR,
    maxReview: 8,
    failOnReview: false,
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
    if (arg === "--fail-on-review") {
      args.failOnReview = true;
      continue;
    }
    if (arg === "--migrations-dir") {
      args.migrationsDir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--max-review") {
      const rawValue = argv[index + 1] ?? "";
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--max-review must be a non-negative integer");
      }
      args.maxReview = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function stripSqlStringLiterals(sql) {
  return sql.replace(/(?:\b[eE])?'(?:''|[^'])*'/g, " ");
}

export function inspectMigrationSql(sql) {
  const stripped = stripSqlStringLiterals(stripSqlComments(sql));
  return REVIEW_PATTERNS.filter((item) => item.pattern.test(stripped)).map((item) => item.id);
}

function parseMigrationName(name) {
  const match = name.match(MIGRATION_FILENAME_PATTERN);
  if (!match?.groups) return null;
  return {
    name,
    timestamp: match.groups.timestamp,
    slug: match.groups.slug,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function buildMigrationInventory({ migrationsDir = DEFAULT_MIGRATIONS_DIR, failOnReview = false } = {}) {
  const resolved = path.resolve(migrationsDir || DEFAULT_MIGRATIONS_DIR);
  try {
    await access(resolved);
  } catch {
    return {
      status: "attention",
      dir: resolved,
      exists: false,
      count: 0,
      first: null,
      latest: null,
      totalBytes: 0,
      duplicateTimestamps: [],
      duplicateSlugs: [],
      invalidSqlFiles: [],
      emptyMigrations: [],
      reviewFlags: [],
      issues: [`migration directory not found: ${resolved}`],
    };
  }

  const dirStat = await stat(resolved);
  if (!dirStat.isDirectory()) {
    return {
      status: "attention",
      dir: resolved,
      exists: true,
      count: 0,
      first: null,
      latest: null,
      totalBytes: 0,
      duplicateTimestamps: [],
      duplicateSlugs: [],
      invalidSqlFiles: [],
      emptyMigrations: [],
      reviewFlags: [],
      issues: [`migration path is not a directory: ${resolved}`],
    };
  }

  const entries = await readdir(resolved, { withFileTypes: true });
  const sqlFileNames = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".sql")).map((entry) => entry.name).sort();
  const parsedMigrations = [];
  const invalidSqlFiles = [];
  let totalBytes = 0;
  const emptyMigrations = [];
  const reviewFlags = [];

  for (const name of sqlFileNames) {
    const parsed = parseMigrationName(name);
    if (!parsed) {
      invalidSqlFiles.push(name);
      continue;
    }

    const filePath = path.join(resolved, name);
    const [fileStat, sql] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    totalBytes += fileStat.size;
    if (sql.trim().length === 0) emptyMigrations.push(name);

    const flags = inspectMigrationSql(sql);
    if (flags.length) {
      reviewFlags.push({ name, flags });
    }

    parsedMigrations.push({ ...parsed, bytes: fileStat.size });
  }

  const timestamps = parsedMigrations.map((migration) => migration.timestamp);
  const slugs = parsedMigrations.map((migration) => migration.slug);
  const duplicateTimestamps = [...new Set(timestamps.filter((stamp, index) => timestamps.indexOf(stamp) !== index))];
  const duplicateSlugs = [...new Set(slugs.filter((slug, index) => slugs.indexOf(slug) !== index))];
  const issues = [];

  if (parsedMigrations.length === 0) issues.push(`no valid migration files found in ${resolved}`);
  if (invalidSqlFiles.length) issues.push(`invalid migration filenames: ${invalidSqlFiles.join(", ")}`);
  if (duplicateTimestamps.length) issues.push(`duplicate migration timestamps: ${duplicateTimestamps.join(", ")}`);
  if (duplicateSlugs.length) issues.push(`duplicate migration slugs: ${duplicateSlugs.join(", ")}`);
  if (emptyMigrations.length) issues.push(`empty migration files: ${emptyMigrations.join(", ")}`);
  if (failOnReview && reviewFlags.length) {
    issues.push(`operator-review migration patterns present in ${reviewFlags.length} migration file(s)`);
  }

  return {
    status: issues.length ? "attention" : "ok",
    dir: resolved,
    exists: true,
    count: parsedMigrations.length,
    first: parsedMigrations[0]?.name ?? null,
    latest: parsedMigrations.at(-1)?.name ?? null,
    totalBytes,
    totalSize: formatBytes(totalBytes),
    duplicateTimestamps,
    duplicateSlugs,
    invalidSqlFiles,
    emptyMigrations,
    reviewFlags,
    issues,
  };
}

function formatInventory(summary, { maxReview = 8 } = {}) {
  const listedReviewFlags = summary.reviewFlags.slice(0, maxReview);
  const hiddenReviewCount = Math.max(0, summary.reviewFlags.length - listedReviewFlags.length);
  const lines = [
    "OpenPlan Supabase migration inventory (read-only)",
    `Status: ${summary.status.toUpperCase()}`,
    "",
    `Directory: ${summary.dir} (${summary.exists ? "found" : "missing"})`,
    `Migrations: ${summary.count}`,
    `Total size: ${summary.totalSize ?? formatBytes(summary.totalBytes)}`,
    `First: ${summary.first ?? "<none>"}`,
    `Latest: ${summary.latest ?? "<none>"}`,
    `Duplicate timestamps: ${summary.duplicateTimestamps.length ? summary.duplicateTimestamps.join(", ") : "none"}`,
    `Duplicate slugs: ${summary.duplicateSlugs.length ? summary.duplicateSlugs.join(", ") : "none"}`,
    `Invalid SQL filenames: ${summary.invalidSqlFiles.length ? summary.invalidSqlFiles.join(", ") : "none"}`,
    `Empty migrations: ${summary.emptyMigrations.length ? summary.emptyMigrations.join(", ") : "none"}`,
    "",
    `Operator-review patterns: ${summary.reviewFlags.length}`,
  ];

  for (const item of listedReviewFlags) {
    lines.push(`  - ${item.name}: ${item.flags.join(", ")}`);
  }
  if (hiddenReviewCount) lines.push(`  - ... ${hiddenReviewCount} more not listed`);

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
  const summary = await buildMigrationInventory(args);
  console.log(args.json ? JSON.stringify(summary, null, 2) : formatInventory(summary, args));
  if (summary.status !== "ok") process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
