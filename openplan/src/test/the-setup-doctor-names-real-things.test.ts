import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  MODELING_WORKER_DECLARATION_ENV,
  MODELING_WORKER_TOKEN_ENV,
  MODELING_WORKER_URL_ENV,
} from "@/lib/config/deployment-health";

/**
 * `npm run doctor` MUST NAME THINGS THAT EXIST.
 *
 * ============================================================== WHY THIS EXISTS
 *
 * The setup doctor's whole job is to be read aloud, by someone installing
 * OpenPlan at an agency, to someone who cannot see their screen. Its output is
 * a series of instructions: set THIS variable, read THAT file, run THIS
 * command. Every one of those is a string, and a string that names something
 * which does not exist is worse than no advice at all — it sends a person who
 * does not know the system looking for a setting that was renamed.
 *
 * That is not hypothetical here. The root README documented
 * `npm exec supabase start`, which fails because npm eats the flag, and it was
 * the SECOND command a new person would type. CLAUDE.md's narrowing of the
 * doc-guard rule exists because of it: do not guard a claim by scanning a
 * document, but DO guard mechanical cross-references, because for those the
 * document IS the artifact and there is no live surface to check instead.
 *
 * `doctor.mjs` is zero-dependency on purpose — it runs BEFORE `npm install`,
 * on a machine where the install may have failed, so it cannot import the
 * TypeScript constants it prints. It restates them. This is the test that makes
 * restating safe.
 */

const APP_ROOT = path.join(__dirname, "..", "..");
const REPO_ROOT = path.join(APP_ROOT, "..");
const doctor = readFileSync(path.join(APP_ROOT, "scripts", "doctor.mjs"), "utf8");

describe("the setup doctor's environment variable names match the app's", () => {
  it("reads the doctor script at all, so everything below is not vacuous", () => {
    expect(doctor.length).toBeGreaterThan(2000);
    expect(doctor).toContain("OpenPlan setup check");
  });

  it("spells every modeling-worker variable the way the app reads it", () => {
    // A variable spelt two ways is an operator sent looking for something that
    // does not exist — and the app would go on ignoring what they did set.
    for (const name of [
      MODELING_WORKER_DECLARATION_ENV,
      MODELING_WORKER_URL_ENV,
      MODELING_WORKER_TOKEN_ENV,
    ]) {
      expect(doctor, `doctor.mjs never mentions ${name}`).toContain(name);
    }
  });

  it("names only variables that .env.example also documents", () => {
    // The doctor tells an operator to set a variable; .env.example is where
    // they set it. One naming a variable the other does not is a dead end.
    const envExample = readFileSync(path.join(APP_ROOT, ".env.example"), "utf8");
    for (const name of [
      MODELING_WORKER_DECLARATION_ENV,
      MODELING_WORKER_URL_ENV,
      MODELING_WORKER_TOKEN_ENV,
    ]) {
      expect(envExample, `.env.example never mentions ${name}`).toContain(name);
    }
  });

  it("probes the health path the worker actually serves", () => {
    // `TRIGGER_HEALTH_PATH` in the worker decides what answers. Probing a
    // different path would report a healthy worker as unreachable, which reads
    // as "my deployment is broken" when it is not.
    const worker = readFileSync(
      path.join(REPO_ROOT, "workers", "aequilibrae_worker", "main.py"),
      "utf8"
    );
    const declared = /TRIGGER_HEALTH_PATH\s*=\s*"([^"]+)"/.exec(worker)?.[1];
    expect(declared, "the worker declares no TRIGGER_HEALTH_PATH").toBeTruthy();
    expect(doctor).toContain(`const WORKER_HEALTH_PATH = "${declared}"`);
  });
});

describe("every file and command the doctor points at resolves", () => {
  /** Repo-relative paths the doctor tells an operator to open or follow. */
  const referencedPaths = [...doctor.matchAll(/`?((?:workers|openplan|docs|supabase)\/[\w./-]+\.\w+)`?/g)]
    .map((match) => match[1])
    .filter((value, index, all) => all.indexOf(value) === index);

  it("finds some paths to check", () => {
    expect(referencedPaths.length).toBeGreaterThan(0);
  });

  it("resolves every file path it names", () => {
    const missing = referencedPaths.filter(
      (relative) => !existsSync(path.join(REPO_ROOT, relative)) && !existsSync(path.join(APP_ROOT, relative))
    );
    expect(missing, "the doctor points at files that do not exist").toEqual([]);
  });

  it("only tells an operator to run npm scripts that exist", () => {
    const pkg = JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const named = [...doctor.matchAll(/`npm run ([a-z:-]+)/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    const missing = named.filter((script) => !(script in pkg.scripts));
    expect(missing, "the doctor names npm scripts that do not exist").toEqual([]);
  });

  it("never tells an operator to run `npm exec` without the -- separator", () => {
    // npm CONSUMES the flag: `npm exec supabase migration up` and
    // `npm exec supabase gen types typescript --local` both fail confusingly.
    // This is the exact defect that shipped in the root README.
    const bare = [...doctor.matchAll(/npm exec (?!--)[a-z]/g)];
    expect(bare.map((match) => match[0]), "use `npm exec -- …`").toEqual([]);
  });
});

/**
 * THE ONE-CLICK DEPLOY TEMPLATE MUST NAME THINGS THE WORKER READS.
 *
 * `render.yaml` is the whole self-host-first posture in one file: OpenPlan
 * ships no hosted worker and does not plan to, so standing one up has to be a
 * button rather than a project. Its failure mode is quiet and expensive — an
 * operator supplies a value for a variable nothing reads, believes the worker
 * is configured, and gets runs that queue forever with no error anywhere.
 *
 * Same reasoning as the doctor above: the document IS the artifact, there is no
 * live surface to check instead, so the mechanical cross-references are guarded.
 */
describe("the Render blueprint configures the worker that actually exists", () => {
  const blueprintPath = path.join(REPO_ROOT, "workers", "aequilibrae_worker", "render.yaml");
  const workerDir = path.join(REPO_ROOT, "workers", "aequilibrae_worker");

  it("exists, because the deploy button is the self-host posture", () => {
    expect(existsSync(blueprintPath)).toBe(true);
  });

  const blueprint = existsSync(blueprintPath) ? readFileSync(blueprintPath, "utf8") : "";

  /** Every `- key: NAME` in the blueprint's envVars. */
  const declaredKeys = [...blueprint.matchAll(/^\s*-\s*key:\s*([A-Z0-9_]+)\s*$/gm)].map(
    (match) => match[1]
  );

  it("declares environment variables at all", () => {
    expect(declaredKeys.length).toBeGreaterThan(4);
  });

  it("names only variables the worker's own code reads", () => {
    // Read from every module in the worker's import graph, not just main.py:
    // an operator setting AEQ_MAX_ZONES needs it read by whichever file uses it.
    const workerSource = readdirSync(workerDir)
      .filter((name) => name.endsWith(".py"))
      .map((name) => readFileSync(path.join(workerDir, name), "utf8"))
      .join("\n");

    const unread = declaredKeys.filter((key) => !workerSource.includes(`"${key}"`));
    expect(unread, "render.yaml sets variables the worker never reads").toEqual([]);
  });

  it("points at the Dockerfile and health path that exist", () => {
    expect(existsSync(path.join(workerDir, "Dockerfile"))).toBe(true);
    expect(blueprint).toContain("dockerfilePath: ./workers/aequilibrae_worker/Dockerfile");

    const worker = readFileSync(path.join(workerDir, "main.py"), "utf8");
    const declared = /TRIGGER_HEALTH_PATH\s*=\s*"([^"]+)"/.exec(worker)?.[1];
    expect(blueprint).toContain(`healthCheckPath: ${declared}`);
  });

  it("forces a trigger token rather than leaving it to be skipped", () => {
    // The worker REFUSES to start in push mode without one, on purpose: an
    // unauthenticated trigger on the public internet lets anyone spend the
    // agency's compute. `generateValue` means the operator cannot omit it.
    const tokenBlock = /- key: OPENPLAN_MODELING_WORKER_TOKEN\s*\n\s*generateValue: true/.test(
      blueprint
    );
    expect(tokenBlock, "the token must be generated, never left blank").toBe(true);
  });

  it("does not ask for the anon key where the service role key is required", () => {
    // The worker writes results directly and needs the service role key. Asking
    // for the anon key would produce a worker that starts, accepts runs, and
    // silently writes nothing.
    expect(declaredKeys).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(declaredKeys).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });
});

/**
 * SELF_HOSTING.md's LINKS AND FILE REFERENCES MUST RESOLVE.
 *
 * The operator guide is read by someone deploying OpenPlan for a team, usually
 * once, usually under time pressure. A link to a file that was renamed sends
 * them looking for something that is not there, and the doc gives no way to
 * tell that from their own mistake.
 *
 * Guarded because these are MECHANICAL cross-references — the narrow case
 * CLAUDE.md carves out from "never guard a claim by scanning a document".
 */
describe("the self-hosting guide points at files that exist", () => {
  const guidePath = path.join(APP_ROOT, "docs", "SELF_HOSTING.md");
  const guide = readFileSync(guidePath, "utf8");

  it("reads the guide, so the checks below are not vacuous", () => {
    expect(guide.length).toBeGreaterThan(5000);
  });

  it("resolves every relative file link", () => {
    // Markdown links of the form [text](../../path/to/file.ext), resolved from
    // the guide's own directory as a reader's browser would.
    const links = [...guide.matchAll(/\]\((\.\.?\/[^)#]+)\)/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(0);

    const missing = links.filter(
      (relative) => !existsSync(path.resolve(path.dirname(guidePath), relative))
    );
    expect(missing, "SELF_HOSTING.md links to files that do not exist").toEqual([]);
  });

  it("never tells an operator to run `npm exec` without the -- separator", () => {
    const bare = [...guide.matchAll(/npm exec (?!--)[a-z]/g)].map((match) => match[0]);
    expect(bare, "use `npm exec -- …`").toEqual([]);
  });

  it("states what success looks like at each step that can fail silently", () => {
    // Every failure in this path is silent or misleading — a blank map reads as
    // broken software, a rejected auth link reads as a bad deployment. A step
    // with no success criterion is a step an operator cannot self-check.
    expect((guide.match(/Success looks like/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("does not still describe the hosted-worker question as undecided", () => {
    // Decided 2026-08-03/04: self-host is the posture, there is no hosted
    // worker. Stale documentation is the hazard CLAUDE.md names — a prior
    // session nearly rebuilt a shipped feature from a stale roadmap.
    expect(guide).not.toMatch(/whether OpenPlan should offer a shared hosted\s+worker/);
    expect(guide).toMatch(/will \*\*not\*\* offer a shared hosted worker/);
  });
});
