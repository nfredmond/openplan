/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const generator = resolve("scripts/ops/synthesis-service-unit.mjs");
let root: string, app: string, environment: string, state: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "openplan-supervisor-"));
  app = join(root, 'app %u $TEST "quoted"');
  environment = join(root, "private %u $TEST.env");
  state = join(root, "state %u $TEST");
  mkdirSync(join(app, "scripts/workers"), { recursive: true });
  mkdirSync(join(app, "node_modules/tsx"), { recursive: true });
  mkdirSync(state, { mode: 0o700 });
  writeFileSync(join(app, "package.json"), "{}");
  writeFileSync(join(app, "node_modules/tsx/package.json"), "{}");
  for (const worker of ["preparation", "execution", "generation"]) writeFileSync(join(app, `scripts/workers/synthesis-${worker}.ts`), "");
  writeFileSync(environment, "SYNTHETIC_SECRET=do-not-copy-this-value\n", { mode: 0o600 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function run(extra: string[] = [], worker = "execution") {
  return spawnSync(process.execPath, [generator, "--worker", worker, "--app-dir", app,
    "--env-file", environment, "--state-dir", state, ...extra], { encoding: "utf8", timeout: 10_000 });
}
function refused(result: ReturnType<typeof run>) {
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("do-not-copy-this-value");
}

describe("reviewable synthesis supervisor units", () => {
  it.each(["preparation", "execution"])("renders %s with retained private state and literal paths", worker => {
    const result = run([], worker);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`scripts/workers/synthesis-${worker}.ts`);
    expect(result.stdout).toContain(worker === "preparation" ? "OPENPLAN_SYNTHESIS_PREPARATION_WORK_DIR=" : "OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR=");
    expect(result.stdout).toContain('app %%u $TEST "quoted"\n');
    expect(result.stdout).toContain("private %%u $$TEST.env");
    expect(result.stdout).toContain("Restart=on-failure");
    expect(result.stdout).toContain("KillMode=control-group");
    expect(result.stdout).toContain("UMask=0077");
    expect(result.stdout).toContain("StandardOutput=journal");
    expect(result.stdout).toContain("StandardError=journal");
    expect(result.stdout).not.toContain("do-not-copy-this-value");
    expect(result.stdout).not.toContain("--once");
  });
  it.each([0o640, 0o604])("refuses a readable-by-others environment with mode %s", mode => {
    chmodSync(environment, mode); refused(run());
  });
  it("refuses a journal directory accessible to other users", () => {
    chmodSync(state, 0o750); refused(run());
  });
  it("refuses absent worker dependencies instead of printing an installable unit", () => {
    rmSync(join(app, "node_modules/tsx/package.json")); refused(run());
  });
  it("refuses missing worker source", () => {
    rmSync(join(app, "scripts/workers/synthesis-execution.ts")); refused(run());
  });
  it("refuses duplicate and unknown options", () => {
    refused(run(["--worker", "preparation"])); refused(run(["--start", "yes"]));
  });
  it("refuses another worker name", () => refused(run([], "generation")));
  it("refuses an existing relative path for the stated reason", () => {
    state = relative(process.cwd(), state);
    const result = run(); refused(result);
    expect(result.stderr).toContain("All paths must be absolute.");
  });
  it("refuses an application path whose trailing space would be stripped", () => {
    renameSync(app, `${app} `); app += " "; refused(run());
  });
  it("refuses an existing path with a line break for the stated reason", () => {
    state = join(root, "line\nbreak"); mkdirSync(state, { mode: 0o700 });
    const result = run(); refused(result);
    expect(result.stderr).toContain("Paths must not contain control characters.");
  });
});
