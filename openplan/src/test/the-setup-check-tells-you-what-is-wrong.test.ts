import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `npm run doctor` IS THE SUPPORT CHANNEL, so it has to be right.
 *
 * OpenPlan is installed by whoever installs software at an agency, often walked
 * through it on a video call by someone who cannot see their screen. Every
 * failure in that path is silent or actively misleading — Docker answers
 * `--version` while switched off, a missing Mapbox token yields a working site
 * with blank maps, `supabase start` looks frozen for ten minutes when it is
 * working. The doctor turns "it's not working" into a readable list.
 *
 * These tests run the REAL script against REAL directories, because the thing
 * being tested is its output — the words a non-technical person reads aloud —
 * and a mocked filesystem would prove nothing about them.
 */

const SCRIPT = join(process.cwd(), "scripts/doctor.mjs");
let workdir: string;

/**
 * Every test here spawns a real Node process which itself shells out to
 * `docker`, `supabase` and `node --version`. Vitest's 5-second default is a
 * limit on machine load, not on correctness: this file timed out on a loaded
 * CI runner while passing locally, which is a gate that fails for reasons
 * unrelated to the code under test. The limit is stated rather than inherited.
 */
const SPAWNING_A_REAL_PROCESS_IS_SLOW_MS = 60_000;

/** Runs the doctor in a throwaway directory. Non-zero exit is expected output, not a crash. */
function doctor(dir: string): { code: number; out: string } {
  // Run the COPY inside `dir`, not the original. The script resolves the app
  // directory from its OWN location, so running the repo's copy would inspect
  // the repo — which has a real .env.local and real node_modules, and made every
  // assertion here pass against the wrong filesystem. The credential test in
  // particular passed vacuously: the fake secret was never in the file it read.
  try {
    const out = execFileSync(process.execPath, [join(dir, "scripts/doctor.mjs")], { cwd: dir, encoding: "utf8" });
    return { code: 0, out };
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? "" };
  }
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "openplan-doctor-"));
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  // The script resolves the app directory relative to itself, so it has to be
  // copied rather than pointed at.
  copyFileSync(SCRIPT, join(workdir, "scripts/doctor.mjs"));
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

const scriptIn = (dir: string) => join(dir, "scripts/doctor.mjs");

describe("the setup check tells you what is wrong", { timeout: SPAWNING_A_REAL_PROCESS_IS_SLOW_MS }, () => {
  it("says the settings file is missing, and how to make one", () => {
    const { code, out } = doctor(join(workdir, "scripts", ".."));

    expect(out).toMatch(/\.env\.local is missing/i);
    // Naming the fix matters more than naming the fault: the reader may not know
    // what a settings file is.
    expect(out).toMatch(/cp \.env\.example \.env\.local/);
    expect(code).toBe(1);
  });

  it("catches a SECRET Mapbox token, which otherwise looks like broken software", () => {
    const dir = mkdtempSync(join(tmpdir(), "openplan-doctor-sk-"));
    mkdirSync(join(dir, "scripts"), { recursive: true });
    copyFileSync(SCRIPT, scriptIn(dir));
    writeFileSync(
      join(dir, ".env.local"),
      "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=a\nSUPABASE_SERVICE_ROLE_KEY=b\nNEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=sk.secret\n"
    );

    const { out } = doctor(dir);

    // The worst failure in the whole setup: the site loads, every map is blank,
    // and nothing anywhere reports an error. Naming sk-vs-pk is the entire value.
    expect(out).toMatch(/SECRET token/i);
    expect(out).toMatch(/pk\./);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a database address that is not a web address", () => {
    const dir = mkdtempSync(join(tmpdir(), "openplan-doctor-url-"));
    mkdirSync(join(dir, "scripts"), { recursive: true });
    copyFileSync(SCRIPT, scriptIn(dir));
    writeFileSync(
      join(dir, ".env.local"),
      "NEXT_PUBLIC_SUPABASE_URL=127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=a\nSUPABASE_SERVICE_ROLE_KEY=b\nNEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.x\n"
    );

    const { out } = doctor(dir);
    expect(out).toMatch(/should start with http/i);
    rmSync(dir, { recursive: true, force: true });
  });

  it("never prints the value of a credential", () => {
    const dir = mkdtempSync(join(tmpdir(), "openplan-doctor-secret-"));
    mkdirSync(join(dir, "scripts"), { recursive: true });
    copyFileSync(SCRIPT, scriptIn(dir));
    const secret = "super-secret-service-role-value-do-not-print";
    writeFileSync(
      join(dir, ".env.local"),
      `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=a\nSUPABASE_SERVICE_ROLE_KEY=${secret}\nNEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.x\n`
    );

    const { out } = doctor(dir);

    // This output gets read aloud on calls, pasted into chats, and screenshotted.
    // The service-role key bypasses every row-level security policy.
    expect(out).not.toContain(secret);
    expect(out).toMatch(/SUPABASE_SERVICE_ROLE_KEY is set/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("distinguishes a blocking problem from a note", () => {
    const dir = mkdtempSync(join(tmpdir(), "openplan-doctor-tone-"));
    mkdirSync(join(dir, "scripts"), { recursive: true });
    copyFileSync(SCRIPT, scriptIn(dir));
    writeFileSync(
      join(dir, ".env.local"),
      "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=a\nSUPABASE_SERVICE_ROLE_KEY=b\nNEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.x\n"
    );

    const { out } = doctor(dir);

    // A busy port is usually OpenPlan already running — reporting that as a
    // failure would send someone to fix a thing that is working.
    expect(out).toContain("FIX");
    expect(out).toMatch(/Dependencies are not installed/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("is runnable before anything is installed", () => {
    // The script is dependency-free on purpose: the machine it most needs to
    // diagnose is one where `npm install` has not run or has failed.
    const source = execFileSync("node", ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(SCRIPT)},'utf8'))`], {
      encoding: "utf8",
    });
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);

    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier, `doctor.mjs may only import Node built-ins, found ${specifier}`).toMatch(/^node:/);
    }
  });
});
