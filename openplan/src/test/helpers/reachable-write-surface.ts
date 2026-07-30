import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * WHAT AN AGENT-REACHABLE ROUTE CAN ACTUALLY WRITE — past its own file.
 *
 * A guard that reads only `route.ts` is not a boundary. Every route in this
 * codebase delegates: it parses a body, checks access, and then calls a lib
 * function that does the writing. `POST /api/reports/[reportId]/generate` is
 * eighty modules deep. A rule that says "this route may not promote a claim
 * tier" while reading four hundred lines of one file forbids nothing the moment
 * someone moves the write one function away — which is the normal shape of a
 * refactor, not an evasion.
 *
 * So the reachable surface is walked: from the route file, follow the imported
 * symbols it CALLS into their modules, take those functions' bodies, and repeat.
 * The unit is the exported function, not the module, because module-level
 * reachability is far too coarse — `src/lib/models/evidence-backbone.ts` both
 * reads claim tiers and writes them, and the report routes import only the
 * reader.
 *
 * It is a static approximation and it is stated as one: it follows direct calls
 * to statically imported symbols. A value passed as a callback, or reached
 * through a dynamic `import()` expression built at runtime, is not followed.
 * What it buys is that moving a write out of a route file no longer moves it out
 * of the guard.
 */

const REPO_ROOT = process.cwd();

export type ReachableChunk = {
  /** `src/lib/x.ts#functionName`, or the file path for the entry itself. */
  label: string;
  /** The file the chunk's source came from — what a failure message should name. */
  file: string;
  source: string;
};

function resolveModule(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(REPO_ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

type ImportBinding = { spec: string; exported: string };

/** Local name → what it is imported as, for every static import in a module. */
function parseImports(moduleSource: string): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();

  for (const match of moduleSource.matchAll(/import\s+([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    const clause = match[1].trim();
    const spec = match[2];
    if (clause.startsWith("type ")) continue;

    const namespace = clause.match(/^\*\s+as\s+(\w+)$/);
    if (namespace) {
      bindings.set(namespace[1], { spec, exported: "*" });
      continue;
    }

    const named = clause.match(/\{([\s\S]*?)\}/);
    if (named) {
      for (const entry of named[1].split(",")) {
        const trimmed = entry.trim();
        if (!trimmed || trimmed.startsWith("type ")) continue;
        const aliased = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
        if (aliased) bindings.set(aliased[2], { spec, exported: aliased[1] });
        else if (/^\w+$/.test(trimmed)) bindings.set(trimmed, { spec, exported: trimmed });
      }
    }

    const defaultImport = clause.match(/^(\w+)\s*(?:,|$)/);
    if (defaultImport) bindings.set(defaultImport[1], { spec, exported: "default" });
  }

  return bindings;
}

/**
 * The source of one exported member, from its declaration to the next top-level
 * `export`. Coarse on purpose: a body that swallows a following non-exported
 * helper over-approximates what is reachable, and over-approximating is the safe
 * direction for a guard.
 */
function extractExportBody(moduleSource: string, exported: string): string | null {
  const declaration = new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const|class)\\s+${exported}\\b`
  ).exec(moduleSource);
  if (!declaration) return null;

  const start = declaration.index;
  const rest = moduleSource.slice(start + declaration[0].length);
  const next = rest.search(/\nexport\s/);
  return next === -1 ? moduleSource.slice(start) : moduleSource.slice(start, start + declaration[0].length + next);
}

function isCalled(source: string, name: string): boolean {
  // `name(` — a call — and never the bare identifier on an import line. A
  // namespace import is reached as `name.member(`, which this also matches.
  return new RegExp(`\\b${name}\\s*[.(]`).test(source);
}

export function collectAgentReachableSources(entryFile: string, maxDepth = 4): ReachableChunk[] {
  const chunks: ReachableChunk[] = [];
  const visited = new Set<string>();

  const walk = (file: string, chunkSource: string, label: string, depth: number) => {
    const key = `${file}#${label}`;
    if (visited.has(key)) return;
    visited.add(key);
    chunks.push({ label, file, source: chunkSource });
    if (depth >= maxDepth) return;

    const moduleSource = readFileSync(file, "utf8");
    const bindings = parseImports(moduleSource);

    for (const [local, binding] of bindings) {
      if (!isCalled(chunkSource, local)) continue;
      const target = resolveModule(binding.spec, file);
      if (!target) continue;

      const targetSource = readFileSync(target, "utf8");

      if (binding.exported === "*") {
        // A namespace import: follow every member actually called off it.
        for (const call of chunkSource.matchAll(new RegExp(`\\b${local}\\.(\\w+)\\s*\\(`, "g"))) {
          const body = extractExportBody(targetSource, call[1]);
          if (body) walk(target, body, `${path.relative(REPO_ROOT, target)}#${call[1]}`, depth + 1);
        }
        continue;
      }

      const body = extractExportBody(targetSource, binding.exported);
      if (body) walk(target, body, `${path.relative(REPO_ROOT, target)}#${binding.exported}`, depth + 1);
    }
  };

  walk(entryFile, readFileSync(entryFile, "utf8"), path.relative(REPO_ROOT, entryFile), 0);
  return chunks;
}

// ---------------------------------------------------------------------------
// What a chunk WRITES.

/** Balanced-delimiter scan: the text between `open` at `startIndex` and its match. */
function matchDelimited(source: string, startIndex: number): string | null {
  const openChar = source[startIndex];
  const closeChar = openChar === "(" ? ")" : openChar === "{" ? "}" : openChar === "[" ? "]" : null;
  if (!closeChar) return null;

  let depth = 0;
  let quote: string | null = null;
  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "{" || character === "[") depth += 1;
    else if (character === ")" || character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 1);
    }
  }
  return null;
}

/**
 * The TOP-LEVEL keys of an object literal — the ones that are column names.
 *
 * Nested keys are inside a jsonb value, not columns: `metadata: { source: … }`
 * is not a provenance tier. Depth is tracked character by character rather than
 * by indentation, because indentation is a lie in minified, single-line, or
 * oddly-wrapped code — and an indentation-based version silently exempted the
 * first key of every object.
 */
export function topLevelObjectKeys(objectText: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < objectText.length; index += 1) {
    const character = objectText[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{" || character === "[" || character === "(") {
      depth += 1;
      continue;
    }
    if (character === "}" || character === "]" || character === ")") {
      depth -= 1;
      continue;
    }
    if (depth !== 1) continue;

    const ahead = objectText.slice(index);
    const key = ahead.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (key) {
      keys.push(key[1]);
      index += key[1].length;
    }
  }

  return keys;
}

/**
 * Every column name a chunk hands to `.insert` / `.update` / `.upsert`.
 *
 * Handles the three shapes a write actually takes in this codebase, which the
 * earlier single regex did not: a literal object (on one line or many), an array
 * of literal objects, and an IDENTIFIER built earlier — `const row = { … };
 * …upsert(row)`. The identifier form is the one that matters most, because it is
 * both the most readable way to write a row builder and the way a tier
 * assignment escapes a value-matching rule: `claim_status: nextTier` carries no
 * string literal to match on.
 */
export function writtenColumns(source: string): string[] {
  const columns: string[] = [];

  for (const call of source.matchAll(/\.(insert|update|upsert)\s*\(/g)) {
    const parenIndex = call.index! + call[0].length - 1;
    const argumentText = matchDelimited(source, parenIndex);
    if (!argumentText) continue;

    const inner = argumentText.slice(1, -1).trim();

    if (inner.startsWith("{")) {
      const object = matchDelimited(inner, 0);
      if (object) columns.push(...topLevelObjectKeys(object));
      continue;
    }

    if (inner.startsWith("[")) {
      const array = matchDelimited(inner, 0);
      if (!array) continue;
      const firstObject = array.indexOf("{");
      if (firstObject === -1) continue;
      const object = matchDelimited(array, firstObject);
      if (object) columns.push(...topLevelObjectKeys(object));
      continue;
    }

    const identifier = inner.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (!identifier) continue;
    const binding = new RegExp(`\\b(?:const|let|var)\\s+${identifier[1]}\\b[^=]*=\\s*\\{`).exec(source);
    if (!binding) continue;
    const object = matchDelimited(source, binding.index + binding[0].length - 1);
    if (object) columns.push(...topLevelObjectKeys(object));
  }

  return columns;
}
