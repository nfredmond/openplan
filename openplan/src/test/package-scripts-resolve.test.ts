import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "@/test/helpers/source-text";

/**
 * A package.json script that names a deleted file breaks silently, because the
 * only thing that runs it is a person typing it. `test:guardrail-suite` named
 * `src/test/workspace-provision-route.test.ts` from the moment commit 094fd40b
 * deleted that file along with the founder-era admin console.
 *
 * The failure was quieter than "the suite stopped running", and worse for it:
 * vitest ignores a filter that matches nothing as long as another filter
 * matches. So the script ran SEVEN of the eight guards it names, printed
 * `Test Files 7 passed (7)`, exited 0, and never named the file that was
 * missing. A gate that silently covers less than it claims keeps answering
 * "the guardrails held" — which is this repo's own defect class, a read that
 * failed reported as a read that found nothing wrong.
 *
 * Measured 2026-08-04 on vitest 4.1.10, the version this repo pins:
 * `vitest run <existing> <missing>` exits 0 and runs the existing file alone,
 * with no mention of the other; only a run where NO filter matches exits 1,
 * with "No test files found, exiting with code 1". Re-measure before trusting
 * this paragraph across a vitest major — the guard below does not depend on it.
 *
 * This is the mechanical cross-reference class (see
 * `docs-mechanical-cross-references.test.ts`): the script IS the artifact, and
 * there is no live surface to check instead.
 *
 * WHAT IT CHECKS. Every token in every script of both npm projects that looks
 * like a file the script READS resolves on disk.
 *
 * WHAT IT DOES NOT CHECK. That the script does the right thing, that a test it
 * names still asserts what its name claims, or that the file is reachable. A
 * substituted path can resolve and still cover nothing.
 *
 * WHEN IT FAILS, the script is almost certainly pointing at something that was
 * renamed or deleted — fix the script. The one legitimate failure is a script
 * that reads a build artifact not in the tree; that needs an exemption written
 * here with the name of whatever produces the file, not a loosened extractor.
 */

const APP_ROOT = process.cwd();
const REPO_ROOT = path.join(APP_ROOT, "..");

const PACKAGES = [
  { name: "openplan/package.json", dir: APP_ROOT },
  { name: "qa-harness/package.json", dir: path.join(REPO_ROOT, "qa-harness") },
];

/** Extensions a script READS. Output extensions (`.log`) are deliberately absent. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".py", ".sql", ".json"];

/**
 * Commands whose next non-flag argument is a path the script WRITES. A path
 * that does not exist yet is the point of `mkdir -p` and `tee`, not a defect.
 */
const WRITES_ITS_NEXT_ARGUMENT = new Set(["mkdir", "tee", ">", ">>", "-o", "--out", "--output"]);

/** File paths a script reads, in the order they appear. */
function scriptFilePaths(command: string): string[] {
  const found: string[] = [];
  let writesNext = false;

  for (const raw of command.split(/\s+/)) {
    const token = raw.replace(/^[('"`]+/, "").replace(/[)'"`;,]+$/, "");
    if (!token) continue;

    if (WRITES_ITS_NEXT_ARGUMENT.has(token)) {
      writesNext = true;
      continue;
    }

    const carriesValue = token.includes("=");
    if (token.startsWith("-") && !carriesValue) continue;

    if (writesNext) {
      writesNext = false;
      continue;
    }

    const value = carriesValue ? token.slice(token.lastIndexOf("=") + 1) : token;
    if (value.includes("://")) continue;
    if (!SOURCE_EXTENSIONS.some((extension) => value.endsWith(extension))) continue;

    found.push(value);
  }

  return found;
}

/** A glob is checked down to its static parent directory — no further. */
function resolvesOnDisk(baseDir: string, candidate: string): boolean {
  const globIndex = candidate.search(/[*?[]/);
  if (globIndex === -1) return existsSync(path.resolve(baseDir, candidate));

  const staticPrefix = candidate.slice(0, globIndex);
  const parent = staticPrefix.slice(0, staticPrefix.lastIndexOf("/") + 1);
  return existsSync(path.resolve(baseDir, parent));
}

/**
 * Every way a test in src/test switched on the live database when measured on
 * 2026-10-12: the describe ternary on LIVE_RLS, `skipIf` or `runIf` on describe
 * or it with LIVE_RLS in the condition, and switches derived from LIVE_RLS
 * (a candidate flag built as LIVE_RLS && another variable). Importing the switch,
 * or reading its environment variable directly, covers the derived forms. Until
 * 2026-10-12 only the ternary was recognized, and the skipIf files were invisible.
 *
 * Blind category: a file that reaches the live stack with no LIVE_RLS switch.
 */
const LIVE_GATE_FORMS = [
  /\bLIVE_RLS\s*\?\s*(?:describe|it|test)\s*:\s*(?:describe|it|test)\.skip\b/,
  /\b(?:describe|it|test)(?:\.\w+)*\.(?:skipIf|runIf)\([^)]*\bLIVE_RLS\b/,
  /\bimport\s*\{[^}]*\bLIVE_RLS\b[^}]*\}\s*from\s*["'][^"']*local-supabase-env["']/,
  /\bprocess\.env\.OPENPLAN_RLS_LIVE_TEST\b/,
];

function isLiveGated(source: string): boolean {
  return LIVE_GATE_FORMS.some((form) => form.test(source));
}

function scriptsOf(dir: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).scripts ?? {};
}

describe("package.json scripts: every path they name resolves", () => {
  it("binds the five chat census entries to populated direct probes in the original approval fixtures", () => {
    const tables = [
      "assistant_action_approvals",
      "assistant_chat_access_checks",
      "assistant_chat_grants",
      "assistant_chat_proposal_intents",
      "assistant_chat_turns",
    ];
    const native = stripSourceComments(readFileSync(path.join(APP_ROOT, "src/test/provider-chat-custody-native.test.ts"), "utf8"));
    const inventory = stripSourceComments(readFileSync(path.join(APP_ROOT, "src/test/rls-isolation.test.ts"), "utf8"));
    const probeList = native.match(/const CHAT_DIRECT_RLS_TABLES = \[([\s\S]*?)\] as const;/)?.[1];
    expect(probeList, "The actual direct probe loop needs its exact five-table input").toBeDefined();
    expect([...probeList!.matchAll(/"([^"]+)"/g)].map(match => match[1])).toEqual(tables);
    const registry = inventory.match(/const DEDICATED_LIVE_RLS_PROBES = new Set\(\[([\s\S]*?)\]\);/)?.[1];
    const expectedRegistry = inventory.match(/expect\(\[\.\.\.DEDICATED_LIVE_RLS_PROBES\]\)\.toEqual\(\[([\s\S]*?)\]\);/)?.[1];
    expect(registry).toBeDefined(); expect(expectedRegistry).toBeDefined();
    for (const table of tables) {
      expect([...registry!.matchAll(/"([^"]+)"/g)].filter(match => match[1] === table), table + " has actual dedicated coverage").toHaveLength(1);
      expect([...expectedRegistry!.matchAll(/"([^"]+)"/g)].filter(match => match[1] === table), table + " stays in the exact registry assertion").toHaveLength(1);
    }
    const helper = native.match(/function directRlsBoundaries\(approvalId: string, intentId: string\) \{([\s\S]*?)\n \}/)?.[1];
    expect(helper).toBeDefined();
    expect(helper).toContain('const tables = CHAT_DIRECT_RLS_TABLES.map(literal).join(",");');
    expect(helper).toContain('{ role: "authenticated", user: id.user }');
    expect(helper).toContain('{ role: "authenticated", user: outsiderId }');
    expect(helper).toContain('{ role: "anon", user: null }');
    expect(helper).toContain("current_user IS DISTINCT FROM actor->>'role'");
    expect(helper).toContain("auth.uid() IS DISTINCT FROM (actor->>'user')::uuid");
    expect(helper).toContain("IF jsonb_array_length(snapshot)=0 THEN RAISE EXCEPTION");
    expect(helper).toContain("IF affected<>1 THEN RAISE EXCEPTION 'Postgres copy did not insert one row");
    expect(helper).toContain("EXCEPTION WHEN SQLSTATE 'P0052' THEN NULL; END;");
    const loops = helper!.split("FOREACH relation_name IN ARRAY ARRAY[${tables}] LOOP");
    expect(loops).toHaveLength(4);
    const directLoop = loops[2].split("END LOOP;")[0];
    for (const operation of ["SELECT count(*) FROM", "INSERT INTO", "UPDATE", "DELETE FROM"]) {
      expect(directLoop, operation + " must reach the actual role/table loop").toContain("format('" + operation + " public.%I");
    }
    expect(directLoop.match(/EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;/g)).toHaveLength(4);
    expect(directLoop.match(/probes:=probes\+1;/g)).toHaveLength(4);
    expect(helper!.match(/EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;/g)).toHaveLength(6);
    expect(helper).toContain("IF seen<>0 THEN RAISE EXCEPTION 'Direct SELECT exposed retained rows");
    expect(helper).toContain("IF affected<>0 THEN RAISE EXCEPTION 'Direct UPDATE reached retained row");
    expect(helper).toContain("IF affected<>0 THEN RAISE EXCEPTION 'Direct DELETE reached retained row");
    expect(helper).toContain("IF snapshot IS DISTINCT FROM baseline->relation_name THEN RAISE EXCEPTION");
    expect(helper).toContain("IF probes<>60 OR refusals<>4 THEN RAISE EXCEPTION");
    for (const rpc of ["assistant_chat_session('read','${id.turn}'", "assistant_chat_intent('read','${intentId}'"]) {
      expect(helper!.split(rpc)).toHaveLength(3);
    }
    const originalApprovalFixture = native.slice(native.indexOf('it.each([{ submittalType: "other", notes: "" }'));
    expect(originalApprovalFixture).toContain('"retains one original approval and receipt after move/viewer downgrade %j"');
    expect(originalApprovalFixture).toContain("${directRlsBoundaries(approvalId, broker.intentId)}");
    expect(originalApprovalFixture).toContain('expect(output).toContain("CHAT_DIRECT_RLS_ASSERTIONS_REACHED:60:4")');
  });

  it("wires both chat native files through the maintained isolated RLS job and both opt-ins", () => {
    const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/rls-isolation.yml"), "utf8");
    const lines = workflow.split(/\r?\n/).filter(line => line.trim() && !line.trimStart().startsWith("#"));
    const jobs = lines.flatMap((line, index) => line === "  rls-isolation:" ? [index] : []);
    expect(jobs).toHaveLength(1);
    const following = lines.slice(jobs[0] + 1);
    const nextJob = following.findIndex(line => /^  \S/.test(line));
    const job = nextJob < 0 ? following : following.slice(0, nextJob);
    expect(job.join("\n")).toContain("      run:\n        working-directory: ./openplan");
    const steps = job.flatMap((line, index) => line === "      - name: Run live RLS isolation proof" ? [index] : []);
    expect(steps).toHaveLength(1);
    const followingStep = job.slice(steps[0] + 1);
    const nextStep = followingStep.findIndex(line => /^      - /.test(line));
    const step = [job[steps[0]], ...(nextStep < 0 ? followingStep : followingStep.slice(0, nextStep))];
    expect(step, "The maintained RLS test step must supply the chat opt-in and the actual absolute CLI cwd").toEqual([
      "      - name: Run live RLS isolation proof",
      "        env:",
      "          OPENPLAN_CHAT_NATIVE_FIXTURE: '1'",
      "          OPENPLAN_SUPABASE_WORKDIR: '${{ github.workspace }}/openplan'",
      "        run: npm run test:rls-live",
    ]);
    const script = scriptsOf(APP_ROOT)["test:rls-live"];
    expect(script).toMatch(/^OPENPLAN_RLS_LIVE_TEST=1 node /);
    const paths = scriptFilePaths(script);
    for (const file of ["src/test/provider-chat-custody-native.test.ts", "src/test/provider-chat-custody-http-native.test.ts"]) {
      expect(paths.filter(candidate => candidate === file), file + " runs in the maintained RLS job").toHaveLength(1);
      const source = stripSourceComments(readFileSync(path.join(APP_ROOT, file), "utf8"));
      expect(source).toMatch(/^const live = LIVE_RLS && process\.env\.OPENPLAN_CHAT_NATIVE_FIXTURE === "1" \? describe : describe\.skip;/m);
      expect(source).toMatch(/if \(!isAbsolute\((?:workdir|process\.env\.OPENPLAN_SUPABASE_WORKDIR \?\? "")\)\)/);
    }
  });

  it("names no file that is missing from disk", () => {
    const missing: string[] = [];

    for (const { name, dir } of PACKAGES) {
      for (const [script, command] of Object.entries(scriptsOf(dir))) {
        for (const candidate of scriptFilePaths(command)) {
          if (!resolvesOnDisk(dir, candidate)) missing.push(`${name} → ${script}: ${candidate}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  /**
   * An extractor that quietly matches nothing turns this file into a green test
   * that proves nothing, which is worse than no test at all. These anchors fail
   * if the extraction stops working, independently of whether the paths exist.
   */
  it("actually extracts the paths the scripts name", () => {
    const appScripts = scriptsOf(APP_ROOT);

    expect(scriptFilePaths(appScripts["worker:aequilibrae"])).toEqual([
      "../workers/aequilibrae_worker/run.sh",
    ]);
    expect(scriptFilePaths(appScripts["doctor"])).toEqual(["scripts/doctor.mjs"]);
    expect(scriptFilePaths(appScripts["test:guardrail-suite"]).length).toBeGreaterThan(5);

    const total = PACKAGES.flatMap(({ dir }) =>
      Object.values(scriptsOf(dir)).flatMap(scriptFilePaths)
    );
    expect(total.length).toBeGreaterThan(40);
  });

  /**
   * The INVERSE cross-reference, and the one that fails silently in the more
   * dangerous direction.
   *
   * The check above proves a script names nothing missing. This proves nothing
   * missing is unnamed. A test whose live half is gated on `LIVE_RLS` runs in
   * exactly one place — `npm run test:rls-live`, which CI also invokes — and that
   * script names its files by hand. Write a new live test, forget the script, and
   * the file passes `npm test` by SKIPPING its only real assertions, reports
   * green, and is never executed by anything. It is a guard that exists and
   * guards nothing: the shipped-invisible class, wearing a test's clothes.
   *
   * That is not hypothetical. `gtfs-feed-status-mirrors-its-current-version.test.ts`
   * arrived in this state on 2026-08-05 and was caught only because its author
   * went looking; nothing in the build would have said a word.
   */
  it("runs every live-gated test somewhere", () => {
    const testDir = path.join(REPO_ROOT, "openplan", "src", "test");
    const liveGated = readdirSync(testDir)
      .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"))
      // This file quotes the gate forms as fixtures; it never touches the stack.
      .filter((name) => name !== "package-scripts-resolve.test.ts")
      .filter((name) => isLiveGated(readFileSync(path.join(testDir, name), "utf8")))
      .map((name) => `src/test/${name}`)
      .sort();

    // Non-vacuity: if the detector stops finding the live tests that certainly
    // exist, it would pass by finding nothing — the failure mode this whole file
    // is about. One anchor per gate form.
    expect(liveGated.length).toBeGreaterThanOrEqual(100);
    expect(liveGated).toContain("src/test/rls-isolation.test.ts");
    expect(liveGated).toContain("src/test/contract-completed-review-rls.test.ts");
    expect(liveGated).toContain("src/test/land-use-plan-creation-rls.test.ts");

    const script = scriptsOf(path.join(REPO_ROOT, "openplan"))["test:rls-live"] ?? "";
    expect(script).not.toBe("");

    const unrun = liveGated.filter((file) => !script.includes(file));
    expect(
      unrun,
      "live-gated test files that `npm run test:rls-live` does not name — they skip under `npm test` " +
        "and run nowhere else, so their assertions have never executed. Add them to the script."
    ).toEqual([]);
  });

  /**
   * Seeded controls for the detector. The skipIf form went unrecognized while
   * about sixty live files used it, so a live file could leave the script and
   * nothing would notice. Each form below must be detected; the worker gate and
   * the mocked switch are not live-database gates and must not be.
   */
  it("recognizes every live gate form, and nothing else", () => {
    const gated = [
      'const describeLive = LIVE_RLS ? describe : describe.skip;',
      "const d=LIVE_RLS?describe:describe.skip;",
      'describe.skipIf(!LIVE_RLS)("completed review", () => {});',
      'it.skipIf(!LIVE_RLS)("refuses a stranger", () => {});',
      'describe.skipIf(!LIVE_RLS || !DECISION_SYNTHESIS_CANDIDATE)("candidate", () => {});',
      'describe.runIf(LIVE_RLS)("live only", () => {});',
      'import {LIVE_RLS} from "./local-supabase-env";\nconst CANDIDATE = LIVE_RLS && x;\ndescribe.skipIf(!CANDIDATE)("c", () => {});',
      'const live = process.env.OPENPLAN_RLS_LIVE_TEST === "1";',
    ];
    for (const source of gated) expect(isLiveGated(source), source).toBe(true);

    const notGated = [
      'const describeWorker = AEQUILIBRAE_INTERPRETER ? describe : describe.skip;',
      'vi.doMock("./local-supabase-env", () => ({ LIVE_RLS: false }));',
      'spawnSync("npx", ["vitest"], { env: { ...process.env, OPENPLAN_RLS_LIVE_TEST: "1" } });',
    ];
    for (const source of notGated) expect(isLiveGated(source), source).toBe(false);
  });

  it("reads paths but not the ones a script writes", () => {
    expect(scriptFilePaths("vitest run src/test/a.test.ts src/test/b.test.tsx")).toEqual([
      "src/test/a.test.ts",
      "src/test/b.test.tsx",
    ]);
    expect(scriptFilePaths("node scripts/ops/x.mjs --config=config/y.json")).toEqual([
      "scripts/ops/x.mjs",
      "config/y.json",
    ]);
    expect(scriptFilePaths("mkdir -p ../out && (npm run qa:gate) | tee ../out/gate.log")).toEqual([]);
    expect(scriptFilePaths("next build --webpack")).toEqual([]);
    expect(scriptFilePaths("curl https://example.test/thing.json")).toEqual([]);
  });
});
