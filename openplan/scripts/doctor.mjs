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

// ── Modeling worker ──────────────────────────────────────────────────────────
// OpenPlan runs FULLY without a worker: every module works, and the modeling
// lane refuses honestly instead of queueing a run nothing will ever execute.
// So nothing here is ever a FIX — a deployment with no worker is a supported
// configuration, and telling an operator to fix a thing they chose would be
// this script inventing a problem.
//
// What it does do is answer the question that is otherwise unanswerable from
// outside: IS THE THING I DEPLOYED ACTUALLY REACHABLE? A push worker's URL can
// be wrong, its token can be missing, or the service can be asleep, and every
// one of those looks identical from the app — a run that sits queued.
const WORKER_DECLARATION_ENV = "OPENPLAN_MODELING_WORKER";
const WORKER_URL_ENV = "OPENPLAN_MODELING_WORKER_URL";
const WORKER_TOKEN_ENV = "OPENPLAN_MODELING_WORKER_TOKEN";
/** The worker's own health path. See TRIGGER_HEALTH_PATH in main.py. */
const WORKER_HEALTH_PATH = "/healthz";

async function probeWorker(baseUrl) {
  const target = baseUrl.replace(/\/+$/, "") + WORKER_HEALTH_PATH;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(target, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error?.name === "AbortError" ? "timed out after 8 seconds" : String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

if (existsSync(envPath)) {
  const workerEnv = new Map();
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) workerEnv.set(match[1], match[2].trim().replace(/^["\']|["\']$/g, ""));
  }

  const declaration = workerEnv.get(WORKER_DECLARATION_ENV) || "";
  const workerUrl = workerEnv.get(WORKER_URL_ENV) || "";
  const workerToken = workerEnv.get(WORKER_TOKEN_ENV) || "";

  if (!workerUrl && !workerToken && !declaration) {
    warn(
      "No modeling worker is configured",
      "That is a complete, supported setup: every other module works, and the modeling lane says so plainly instead of queueing a run nothing will run. To add one later, follow workers/aequilibrae_worker/DEPLOY.md."
    );
  } else if (workerUrl && !workerToken) {
    // The app refuses to trigger an unauthenticated worker, so this combination
    // silently does nothing — runs queue forever with no error anywhere.
    bad(
      `${WORKER_URL_ENV} is set but ${WORKER_TOKEN_ENV} is not`,
      "OpenPlan will not trigger an unauthenticated worker, so nothing is pushed and runs wait forever. Set the same token here and on the worker, or clear both."
    );
  } else if (workerToken && !workerUrl) {
    bad(
      `${WORKER_TOKEN_ENV} is set but ${WORKER_URL_ENV} is not`,
      "There is nowhere to push a run, so the token does nothing. Set the worker's address, or clear both."
    );
  } else if (workerUrl) {
    const probe = await probeWorker(workerUrl);
    if (probe.ok) {
      ok(`Modeling worker answered at ${WORKER_HEALTH_PATH}`);
    } else if (probe.status) {
      bad(
        `Modeling worker answered ${probe.status} at ${WORKER_HEALTH_PATH}`,
        `The address in ${WORKER_URL_ENV} is reachable but did not report healthy. Check the worker's own logs — this is the worker, not OpenPlan.`
      );
    } else {
      bad(
        "Could not reach the modeling worker",
        `${probe.error}. Check ${WORKER_URL_ENV}. A free-tier host that sleeps when idle can take a minute to wake — try once more before changing anything.`
      );
    }
  } else if (declaration) {
    // Declared but no URL: a POLLING worker, which exposes nothing to probe.
    const recognised = ["deployed", "absent"].includes(declaration);
    if (!recognised) {
      bad(
        `${WORKER_DECLARATION_ENV} is set to "${declaration}", which OpenPlan does not recognise`,
        'The accepted values are "deployed" and "absent". A value it cannot read is reported rather than guessed at.'
      );
    } else if (declaration === "deployed") {
      warn(
        "A polling modeling worker is declared, and cannot be checked from here",
        "A polling worker reads runs out of the database and exposes no address to probe, so this is your statement rather than something measured. If runs stay queued, check the worker's own logs."
      );
    } else {
      ok(`${WORKER_DECLARATION_ENV} says this deployment has no worker`);
    }
  }
}

// ── The modeling worker that runs county runs ────────────────────────────────
// A DIFFERENT worker from the one above. This is the one /county-runs pushes to
// — the container `npm run modeling:up` starts — and it is the difference
// between "OpenPlan estimated 24.9 vehicle-miles per person" and "OpenPlan
// wrote down a job for someone to run by hand". Both are supported; only one of
// them produces a number, and which one you have is not visible from any page
// until you have already clicked.
//
// Two failures are specific to this worker and silent in different ways:
//   - the address is set but nothing answers, so runs are dispatched into
//     nowhere and simply never come back;
//   - the worker is fine but CENSUS_API_KEY is missing, so every run stops in
//     its first second (the Census Bureau stopped answering keyless requests).
const COUNTY_WORKER_URL_ENV = "OPENPLAN_COUNTY_ONRAMP_WORKER_URL";

if (existsSync(envPath)) {
  const countyEnv = new Map();
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) countyEnv.set(match[1], match[2].trim().replace(/^["']|["']$/g, ""));
  }

  const countyWorkerUrl = countyEnv.get(COUNTY_WORKER_URL_ENV) || "";

  if (!countyWorkerUrl) {
    warn(
      "Travel modelling is not switched on",
      "Everything else works. Launching a county run will PREPARE the job and say so, rather than run a model — nothing executes it. To turn it on: `npm run modeling:up` (first build takes a few minutes), then add OPENPLAN_COUNTY_ONRAMP_WORKER_URL=http://127.0.0.1:8686/jobs to .env.local and restart OpenPlan."
    );
  } else {
    // The variable holds the JOB endpoint; health lives beside it.
    const probe = await probeWorker(countyWorkerUrl.replace(/\/jobs\/?$/, ""));
    if (probe.ok) {
      ok("The modeling worker answered — county runs will actually run");
    } else if (probe.status) {
      bad(
        `The modeling worker answered ${probe.status} instead of reporting healthy`,
        `Something is listening at ${COUNTY_WORKER_URL_ENV} but it is not this worker, or it is unwell. Check its own log with \`npm run modeling:logs\`.`
      );
    } else {
      bad(
        "Could not reach the modeling worker",
        `${probe.error}. Runs will be dispatched to this address and never come back. Start it with \`npm run modeling:up\`, or clear ${COUNTY_WORKER_URL_ENV} to go back to the honest prepare-only behaviour.`
      );
    }

    if (!countyEnv.get("CENSUS_API_KEY")) {
      bad(
        "CENSUS_API_KEY is not set, and the modeling worker needs it",
        "Every model starts from Census population and jobs data, and the Census Bureau no longer answers without a key, so every run will stop in its first second. The key is free and arrives by email: api.census.gov/data/key_signup.html — click the activation link, an unactivated key is refused the same way."
      );
    }

    // The worker has no browser session, so this token is the ONLY way its
    // finished-run callback is accepted. Unset, the model runs correctly for
    // minutes and the result is refused at the door with a 401 that only the
    // worker's own log records — the run just never appears.
    if (!countyEnv.get("OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN")) {
      bad(
        "OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN is not set, so finished runs will be rejected",
        "The worker will run the model and OpenPlan will refuse the result, because nothing proves the result came from your worker. Set it to any long random string — it is shared only between OpenPlan and the jobs it sends out, and nothing needs to be changed on the worker."
      );
    }
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
