import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every third-party module a modeling script imports must be listed in the
 * requirements for the runtime that owns that script. The county/AequilibraE
 * requirements are the default; dedicated ActivitySim scripts are mapped to
 * the execution or estimation environment below.
 *
 * WHY THIS IS A TEST AND NOT A README LINE. The modeling worker's Docker image
 * shipped for its whole life installing four packages — Flask, gunicorn,
 * requests, python-dotenv — because that is genuinely all the worker PROCESS
 * imports. The model is a subprocess, and its imports are invisible from the
 * worker's own import graph. The result was an image that built, started,
 * answered /healthz, accepted a job, and failed it about a second later with
 * ModuleNotFoundError. Every signal upstream of the failure was green.
 *
 * That is the shipped-invisible shape this repo keeps rediscovering, and no
 * amount of care in the Dockerfile prevents the next one: someone adds
 * `import scipy` to a modeling script months from now, every test passes, and
 * the first person to find out is a planner whose run dies. So the code is the
 * source of truth and this walks it.
 *
 * WHAT IT CANNOT SEE, said plainly: that the listed versions install, that they
 * are ABI-compatible with each other, or that a run completes. Those need a
 * real build and a real run — the reason `docker compose up --build` is a
 * documented step and not a claim made here.
 */

const REPO_ROOT = path.join(process.cwd(), "..");
const MODELING_DIR = path.join(REPO_ROOT, "scripts", "modeling");
const COUNTY_REQUIREMENTS = path.join(MODELING_DIR, "requirements.txt");
const ACTIVITYSIM_EXEC_REQUIREMENTS = path.join(
  REPO_ROOT,
  "workers",
  "activitysim_worker",
  "requirements-exec.txt"
);
const ACTIVITYSIM_ESTIMATION_REQUIREMENTS = path.join(
  REPO_ROOT,
  "workers",
  "activitysim_worker",
  "requirements-estimation.txt"
);

/**
 * Scripts that run only inside a dedicated ActivitySim environment. Everything
 * else defaults to the county/AequilibraE image. This mapping is intentionally
 * by script rather than a union of requirement files: a union would let a
 * county import pass merely because another image happens to install it.
 */
const SPECIALIZED_REQUIREMENTS_BY_SCRIPT = new Map([
  [
    path.join(MODELING_DIR, "activitysim_auto_ownership_fit.py"),
    ACTIVITYSIM_ESTIMATION_REQUIREMENTS,
  ],
  [
    path.join(MODELING_DIR, "mandatory_tour_frequency_acceptance.py"),
    ACTIVITYSIM_EXEC_REQUIREMENTS,
  ],
]);

/**
 * Directories whose `.py` files a modeling script may import as a sibling —
 * `run_screening_model.py` and friends put both on `sys.path` before importing.
 * A name resolved here is repo code, not a dependency.
 */
const LOCAL_MODULE_DIRS = [
  MODELING_DIR,
  path.join(MODELING_DIR, "tests"),
  path.join(REPO_ROOT, "workers", "activitysim_worker"),
  path.join(REPO_ROOT, "workers", "aequilibrae_worker"),
];

/**
 * Python standard-library modules these scripts import. Deliberately explicit
 * rather than inferred: a name that is neither here nor in requirements.txt
 * fails the test, so a new dependency cannot slip through by looking ordinary.
 * Adding a genuinely-stdlib name here is a one-line change with an obvious
 * reviewer question — "is this really stdlib?" — which is the point.
 */
const PYTHON_STDLIB = new Set([
  "__future__", "argparse", "collections", "concurrent", "contextlib", "copy", "csv",
  "dataclasses", "datetime", "functools", "gzip", "hashlib", "importlib", "io",
  "inspect", "itertools", "json", "logging", "math", "os", "pathlib", "platform", "random", "re",
  "shlex", "shutil", "sqlite3", "statistics", "string", "subprocess", "sys",
  "tempfile", "textwrap", "time", "traceback", "types", "typing", "unittest",
  "urllib", "uuid", "warnings", "zipfile",
]);

/**
 * `import x`, `import x.y as z`, and `from x.y import z`, at any indentation —
 * a lazy import inside a function still has to be installed.
 */
const IMPORT_PATTERNS: readonly RegExp[] = [
  /^\s*import\s+([A-Za-z_][A-Za-z0-9_]*)/,
  /^\s*from\s+([A-Za-z_][A-Za-z0-9_]*)[A-Za-z0-9_.]*\s+import\s/,
];

/**
 * Remove docstrings and comments before scanning.
 *
 * Not defensive tidying — the first run of this test reported a missing
 * dependency called `a`, from the sentence "from a default. A count set carries
 * …" inside a module docstring. Prose reaching a matcher has broken five guards
 * in this repository, in both directions, and it would have broken this one on
 * day one.
 *
 * Deliberately NOT `stripSourceComments` from `@/test/helpers/source-text`:
 * that helper is for `//` and block comments, and its own docblock says a
 * different comment syntax must be a separate function chosen by a caller who
 * knows what they are reading. Python's are `#` and triple quotes, and pointing
 * the JavaScript stripper at a `.py` file would silently do nothing.
 */
function withoutProse(source: string): string {
  return source
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/'''[\s\S]*?'''/g, "")
    .replace(/^\s*#.*$/gm, "");
}

function pythonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".py"))
    .map((entry) => path.join(dir, entry));
}

function localModuleNames(): Set<string> {
  const names = new Set<string>();
  for (const dir of LOCAL_MODULE_DIRS) {
    if (!existsSync(dir)) continue;
    for (const file of pythonFiles(dir)) names.add(path.basename(file, ".py"));
  }
  return names;
}

function importedRootModules(): Map<string, string[]> {
  const byModule = new Map<string, string[]>();
  for (const file of pythonFiles(MODELING_DIR)) {
    const relative = path.relative(REPO_ROOT, file);
    for (const line of withoutProse(readFileSync(file, "utf8")).split("\n")) {
      for (const pattern of IMPORT_PATTERNS) {
        const match = pattern.exec(line);
        if (!match) continue;
        const existing = byModule.get(match[1]) ?? [];
        if (!existing.includes(relative)) existing.push(relative);
        byModule.set(match[1], existing);
      }
    }
  }
  return byModule;
}

/** Distribution names in a requirements file and its relative `-r` includes. */
function declaredDistributions(requirements: string, visited = new Set<string>()): Set<string> {
  const resolved = path.resolve(requirements);
  if (visited.has(resolved)) return new Set();
  visited.add(resolved);

  const declared = new Set<string>();
  for (const rawLine of readFileSync(resolved, "utf8").split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const include = /^-r\s+(.+)$/.exec(line);
    if (include) {
      for (const distribution of declaredDistributions(
        path.resolve(path.dirname(resolved), include[1].trim()),
        visited
      )) {
        declared.add(distribution);
      }
      continue;
    }
    declared.add(line.split(/[<>=!~[;]/)[0].trim().toLowerCase());
  }
  return declared;
}

describe("the modeling requirements cover what the modeling code imports", () => {
  it("lists every third-party module scripts/modeling imports", () => {
    const local = localModuleNames();
    const declaredByRequirements = new Map<string, Set<string>>();
    const declarationsFor = (requirements: string) => {
      const existing = declaredByRequirements.get(requirements);
      if (existing) return existing;
      const declared = declaredDistributions(requirements);
      declaredByRequirements.set(requirements, declared);
      return declared;
    };

    const missing: string[] = [];
    for (const [module, files] of importedRootModules()) {
      if (PYTHON_STDLIB.has(module) || local.has(module)) continue;
      for (const relativeFile of files) {
        const absoluteFile = path.join(REPO_ROOT, relativeFile);
        const requirements =
          SPECIALIZED_REQUIREMENTS_BY_SCRIPT.get(absoluteFile) ?? COUNTY_REQUIREMENTS;
        if (declarationsFor(requirements).has(module.toLowerCase())) continue;
        missing.push(
          `${module} (imported by ${relativeFile}) is not in ${path.relative(REPO_ROOT, requirements)} — ` +
            `add it there, map the script to its real runtime, or add it to PYTHON_STDLIB if it is standard library`
        );
      }
    }

    expect(missing).toEqual([]);
  });

  it("guards the guard — the scan reaches real files and the known dependencies are found", () => {
    const modules = importedRootModules();
    // The scan must actually be reading the modeling scripts.
    expect(modules.size).toBeGreaterThan(20);
    expect(modules.get("geopandas")).toContain(path.join("scripts", "modeling", "screening_runtime.py"));

    // Every heavy dependency the container must install is genuinely reached
    // from this directory — if one of these ever stops being imported here, the
    // requirements list has drifted and should shrink.
    const declared = declaredDistributions(COUNTY_REQUIREMENTS);
    for (const heavy of ["aequilibrae", "geopandas", "numpy", "pandas", "shapely", "requests", "scipy"]) {
      expect(modules.has(heavy), `${heavy} is declared but no modeling script imports it`).toBe(true);
      expect(declared.has(heavy)).toBe(true);
    }

    const activitysim = declaredDistributions(ACTIVITYSIM_EXEC_REQUIREMENTS);
    for (const locked of ["activitysim", "numpy", "pandas", "numba", "scipy"]) {
      expect(activitysim.has(locked), `${locked} is missing from the ActivitySim execution image`).toBe(true);
    }
    const estimation = declaredDistributions(ACTIVITYSIM_ESTIMATION_REQUIREMENTS);
    expect(estimation.has("activitysim")).toBe(true);
    expect(estimation.has("larch6")).toBe(true);
    expect(declared.has("activitysim")).toBe(false);

    // And a module that is neither stdlib nor local nor declared must be
    // reported, or the check above could be vacuously green.
    const local = localModuleNames();
    expect(
      PYTHON_STDLIB.has("tensorflow") ||
        local.has("tensorflow") ||
        declared.has("tensorflow") ||
        activitysim.has("tensorflow") ||
        estimation.has("tensorflow")
    ).toBe(false);
  });
});
