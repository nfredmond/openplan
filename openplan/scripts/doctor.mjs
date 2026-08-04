#!/usr/bin/env node
/**
 * `npm run doctor` — is this computer ready to run OpenPlan, and if not, what exactly is wrong?
 *
 * WHY THIS EXISTS. Every failure in OpenPlan's local setup is SILENT or actively
 * misleading, which is a problem when the person installing it is on a video
 * call with someone who cannot see their screen:
 *
 *   - `docker --version` answers happily while the Docker daemon is switched
 *     off, so "Docker is installed" and "Docker works" look identical;
 *   - `supabase start` prints nothing for ten minutes on a first run WHEN IT IS
 *     WORKING, which is indistinguishable from a hang;
 *   - `npm install` prints an alarming warning about blocked install scripts
 *     that is entirely harmless;
 *   - a missing Mapbox token produces a page that loads correctly with blank
 *     maps, which reads as "the software is broken" rather than "one line is
 *     missing from a settings file".
 *
 * So this turns "it's not working, what do you see?" into "run `npm run doctor`
 * and read me the output". Every line is written to be read ALOUD by someone who
 * does not know what any of these tools are.
 *
 * ZERO DEPENDENCIES, AND IT RUNS BEFORE `npm install`. Node's own modules only,
 * so a machine that has not installed anything yet — or where the install
 * failed — can still be diagnosed. Run it directly with `node scripts/doctor.mjs`
 * if even the npm script is not available.
 *
 * IT NEVER CLAIMS SOMETHING WORKS THAT IT HAS NOT TESTED. Where a check cannot
 * be made, it says so rather than passing by default — the same rule the product
 * itself follows about unreadable data.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Required to start at all. See `.env.example`, which marks the same four. */
const REQUIRED_ENV = [
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    missing: "OpenPlan cannot reach its database. Copy the API URL that `supabase start` printed.",
    check: (value) =>
      /^https?:\/\//.test(value) ? null : "This does not look like a web address — it should start with http:// or https://",
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    missing: "Copy the anon key that `supabase start` printed.",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    missing: "Copy the service_role key that `supabase start` printed. Keep it private.",
  },
  {
    key: "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN",
    missing:
      "Maps will be blank — and the map is most of OpenPlan. Get a free PUBLIC token from mapbox.com.",
    check: (value) =>
      value.startsWith("pk.")
        ? null
        : value.startsWith("sk.")
          ? "This is a SECRET token (starts with sk.). Browsers cannot use it — you need the public one, starting with pk."
          : "A Mapbox public token normally starts with 'pk.' — check you copied the default public token.",
  },
];

const results = [];
const record = (state, title, detail = null) => results.push({ state, title, detail });
const ok = (title, detail) => record("ok", title, detail);
const bad = (title, detail) => record("bad", title, detail);
const warn = (title, detail) => record("warn", title, detail);

function run(command, args) {
  try {
    return { ok: true, out: execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (error) {
    return { ok: false, out: String(error?.stderr || error?.message || "").trim() };
  }
}

// ── Node ─────────────────────────────────────────────────────────────────────
const MIN_NODE_MAJOR = 20;
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(nodeMajor) && nodeMajor >= MIN_NODE_MAJOR) {
  ok(`Node.js ${process.versions.node}`);
} else {
  bad(
    `Node.js ${process.versions.node} is too old`,
    `OpenPlan needs version ${MIN_NODE_MAJOR} or higher. Install the "LTS" version from nodejs.org, then close this window and open a new one.`
  );
}

// ── Docker ───────────────────────────────────────────────────────────────────
// `--version` is deliberately NOT the test: it answers while the daemon is off.
const dockerVersion = run("docker", ["--version"]);
if (!dockerVersion.ok) {
  bad(
    "Docker is not installed",
    "OpenPlan's database runs inside Docker. Install Docker Desktop from docker.com, then open it."
  );
} else {
  const dockerInfo = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (dockerInfo.ok) {
    ok(`Docker is installed and running (engine ${dockerInfo.out || "unknown version"})`);
  } else {
    bad(
      "Docker is installed but NOT RUNNING",
      "Open Docker Desktop and wait for the whale icon to stop animating — that can take a minute or two. On Linux: `sudo systemctl start docker`, and if it says permission denied, you skipped the log-out-and-back-in after installing."
    );
  }
}

// ── Ports ────────────────────────────────────────────────────────────────────
async function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

const PORTS = [
  { port: 3000, what: "OpenPlan itself", fix: "Something else is using it — close it, or start OpenPlan with `npm run dev -- --port 3001`." },
  { port: 54321, what: "the database", fix: "Usually this means OpenPlan's database is ALREADY RUNNING, which is fine. If not, something else has taken the port." },
];

for (const { port, what, fix } of PORTS) {
  if (await portFree(port)) ok(`Port ${port} is free (${what})`);
  else warn(`Port ${port} is in use (${what})`, fix);
}

// ── Dependencies ─────────────────────────────────────────────────────────────
if (existsSync(join(APP_DIR, "node_modules"))) {
  ok("Dependencies are installed");
} else {
  bad("Dependencies are not installed", "Run `npm install` in this folder first. It takes about a minute.");
}

// ── Settings file ────────────────────────────────────────────────────────────
const envPath = join(APP_DIR, ".env.local");
if (!existsSync(envPath)) {
  bad(
    "The settings file .env.local is missing",
    "Run `cp .env.example .env.local`, then open it and fill in the four required values. `npm exec -- supabase start` prints three of them."
  );
} else {
  // A deliberately small parser: `KEY=value`, ignoring comments and blank lines.
  // Values are never printed — three of these four are credentials.
  const env = new Map();
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) env.set(match[1], match[2].trim().replace(/^["']|["']$/g, ""));
  }

  ok(".env.local exists");

  for (const { key, missing, check } of REQUIRED_ENV) {
    const value = env.get(key);
    if (!value) {
      bad(`${key} is not set`, missing);
      continue;
    }
    const problem = check?.(value);
    if (problem) bad(`${key} looks wrong`, problem);
    else ok(`${key} is set`);
  }
}

// ── Database migrations ──────────────────────────────────────────────────────
// "The app deployed but many surfaces say could not be read" is almost always
// a database that is behind the code. This answers "did the migrations
// actually run?" in one command instead of a support conversation.
const migrationsDir = join(APP_DIR, "supabase", "migrations");
if (existsSync(migrationsDir)) {
  const fileVersions = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, 14))
    .sort();

  // The local database container is named after supabase/config.toml's
  // project_id, which itself defaults to the app directory's name when the
  // config does not set one (Supabase's own rule) — never hardcoded, so any
  // checkout name works.
  const configPath = join(APP_DIR, "supabase", "config.toml");
  const projectId =
    (existsSync(configPath)
      ? /^\s*project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(configPath, "utf8"))?.[1]
      : null) ?? APP_DIR.split(/[\\/]/).filter(Boolean).pop();
  const container = projectId ? `supabase_db_${projectId}` : null;
  const containerUp =
    container && run("docker", ["ps", "--format", "{{.Names}}"]).out?.split("\n").includes(container);

  if (!containerUp) {
    warn(
      "Could not check whether the database has all migrations",
      "The local database is not running (that is fine if you use a hosted project — compare with `npm exec -- supabase migration list --linked` instead)."
    );
  } else {
    const applied = run("docker", [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-tAc",
      "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
    ]);
    if (!applied.ok) {
      warn(
        "Could not read the database's applied-migrations list",
        "The database is running but did not answer. If OpenPlan otherwise works, this is safe to ignore."
      );
    } else {
      const appliedVersions = new Set(applied.out.split("\n").map((line) => line.trim()).filter(Boolean));
      const behind = fileVersions.filter((version) => !appliedVersions.has(version));
      if (behind.length === 0) {
        ok(`Database has all ${fileVersions.length} migrations applied`);
      } else {
        bad(
          `Database is ${behind.length} migration${behind.length === 1 ? "" : "s"} behind the code`,
          'Run `npm exec -- supabase migration up`. Until then, some pages will say "could not be read" — that is this, not a bug.'
        );
      }
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const MARK = { ok: "  OK  ", warn: " NOTE ", bad: " FIX  " };

console.log("\nOpenPlan setup check\n" + "=".repeat(60));
for (const { state, title, detail } of results) {
  console.log(`[${MARK[state]}] ${title}`);
  if (detail) console.log(`          ${detail}`);
}

const problems = results.filter((r) => r.state === "bad");
const notes = results.filter((r) => r.state === "warn");

console.log("=".repeat(60));
if (problems.length === 0) {
  console.log(
    notes.length > 0
      ? `Nothing is blocking you. ${notes.length} note${notes.length === 1 ? "" : "s"} above — read ${notes.length === 1 ? "it" : "them"}, they are usually fine.`
      : "Everything checks out. Run `npm run dev` and open http://localhost:3000"
  );
} else {
  console.log(
    `${problems.length} thing${problems.length === 1 ? "" : "s"} to fix, listed above as FIX. Work through them top to bottom — later ones often fix themselves.`
  );
}
console.log("");

// Non-zero only for real blockers, so this can gate a script without failing on
// a port that is busy because OpenPlan is already running.
process.exit(problems.length > 0 ? 1 : 0);
