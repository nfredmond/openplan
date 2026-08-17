import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every third-party module the screening model imports must be listed in
 * `scripts/modeling/requirements.txt`.
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
const REQUIREMENTS = path.join(MODELING_DIR, "requirements.txt");

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
  "__future__", "argparse", "collections", "concurrent", "contextlib", "csv",
  "dataclasses", "datetime", "functools", "gzip", "hashlib", "importlib", "io",
  "itertools", "json", "logging", "math", "os", "pathlib", "random", "re",
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

/** Distribution names in a requirements file, lowercased, without versions. */
function declaredDistributions(): Set<string> {
  return new Set(
    readFileSync(REQUIREMENTS, "utf8")
      .split("\n")
      .map((line) => line.replace(/#.*$/, "").trim())
      .filter(Boolean)
      .map((line) => line.split(/[<>=!~[;]/)[0].trim().toLowerCase())
  );
}

describe("the modeling requirements cover what the modeling code imports", () => {
  it("lists every third-party module scripts/modeling imports", () => {
    const local = localModuleNames();
    const declared = declaredDistributions();

    const missing: string[] = [];
    for (const [module, files] of importedRootModules()) {
      if (PYTHON_STDLIB.has(module) || local.has(module)) continue;
      if (declared.has(module.toLowerCase())) continue;
      missing.push(
        `${module} (imported by ${files.join(", ")}) is not in scripts/modeling/requirements.txt — ` +
          `add it there, or add it to PYTHON_STDLIB in this test if it really is standard library`
      );
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
    const declared = declaredDistributions();
    for (const heavy of ["aequilibrae", "geopandas", "numpy", "pandas", "shapely", "requests"]) {
      expect(modules.has(heavy), `${heavy} is declared but no modeling script imports it`).toBe(true);
      expect(declared.has(heavy)).toBe(true);
    }

    // And a module that is neither stdlib nor local nor declared must be
    // reported, or the check above could be vacuously green.
    const local = localModuleNames();
    expect(PYTHON_STDLIB.has("scipy") || local.has("scipy") || declared.has("scipy")).toBe(false);
  });
});
