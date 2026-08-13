import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/source-text";

/**
 * AN ANCHOR INSIDE A CARD THAT REPEATS MUST CARRY THE ROW'S OWN ID.
 *
 * The defect, shipped 2026-08-12 and repaired the same day:
 * `close-loop-builder.tsx` gave its broadcast notice a bare
 * `id="closeloop-broadcast-notice"`. The notice lives in `CloseLoopCard`, which
 * `EngagementCloseLoopBuilder` renders once per close-the-loop entry 140 lines
 * further down the file. Publish a second entry and the document holds two
 * elements with one id — `getElementById` answers with whichever came first, so
 * the console's deep link scrolls to the wrong entry's notice, silently and
 * only for the campaigns that got far enough to have two.
 *
 * WHY THIS IS A MECHANISM AND NOT A NOTE. The repo already fixed exactly this
 * in `rtp-chapter-draft-assist.tsx`, and wrote down why, and it recurred
 * anyway six weeks later in another module. A comment cannot police the next
 * card component; nothing here is a hand-written list of files or ids.
 *
 * WHAT IT CHECKS, derived from source every run:
 *   for every `.tsx` outside the test tree, take each `.map(…)` callback body,
 *   take every capitalised JSX tag rendered inside it, resolve that tag to its
 *   component definition (same file, or through the file's own imports), and
 *   report any literal `id="…"` written in that definition's body. A literal id
 *   in a component that is rendered once per row is a duplicate id waiting for
 *   a second row. The fix is always the same: interpolate the row's id, as the
 *   RTP chapter assist and the close-loop card now both do.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK, and why. A literal `id="…"` written
 * DIRECTLY inside a `.map()` body is not reported. There is one such site today
 * — `campaign-publish-flow.tsx` renders `id="publish-flow-description"` inside
 * a checklist map, guarded by `id === "public_description"`, so it renders at
 * most once and is correct. Reporting it would force an exemption list, and an
 * exemption list is a ratchet that only ever grows. The distinction is also the
 * honest one: an id two lines under the `.map(` that produced it is visible to
 * anyone reading the diff, while the id this guard hunts sits in a different
 * function with nothing nearby to say the component repeats.
 *
 * OTHER LIMITS, stated because a guard whose limits are unwritten gets trusted
 * past them. It sees only what the regexes see: a component reached through a
 * prop or a `children` slot rather than a JSX tag, a component defined as
 * `const X = memo(...)` or `forwardRef(...)`, and a repeat driven by something
 * other than `.map(` (a `for` loop building an array, a list rendered from a
 * fixed tuple) are all invisible. Every miss fails SILENT, not loud, so this
 * narrows the class rather than closing it. It also proves nothing about ids
 * that are duplicated across two DIFFERENT components on one page — that needs
 * a rendered document, not source.
 */

const SRC = path.join(process.cwd(), "src");

/** Every `.tsx` under `src` that ships to a user — the test tree renders its
 * own throwaway markup and duplicate ids there hurt nobody. */
function shippedComponentFiles(dir: string = SRC, into: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "test" || entry === "node_modules") continue;
      shippedComponentFiles(full, into);
    } else if (entry.endsWith(".tsx")) {
      into.push(full);
    }
  }
  return into;
}

/** The index of the bracket closing the one that opens at `start`. */
function matchingBracket(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let at = start; at < source.length; at += 1) {
    if (source[at] === open) depth += 1;
    else if (source[at] === close) {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Component name → the file it comes from. Type imports render nothing. */
function componentImports(file: string, source: string): Map<string, string> {
  const imports = new Map<string, string>();
  for (const match of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
    if (match[1]) continue;
    const target = resolveImport(file, match[3]);
    if (!target) continue;
    for (const clause of match[2].split(",")) {
      const trimmed = clause.trim();
      if (!trimmed || trimmed.startsWith("type ")) continue;
      const name = trimmed.split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Z]/.test(name)) imports.set(name, target);
    }
  }
  return imports;
}

/**
 * The body of `function Name(…) { … }` or `const Name = (…) => { … }`, or null
 * when neither spelling is present in this source.
 *
 * The parameter list is skipped by bracket matching rather than by looking for
 * the next `{`: a destructured props object (`function Card({ entry }: {…})`)
 * opens a brace before the body does, and an earlier version of this walk
 * scanned that props pattern instead of the component and reported nothing at
 * all — including on the very defect it was written for.
 */
function componentBody(source: string, name: string): string | null {
  const declaration =
    source.match(new RegExp(`function\\s+${name}\\s*\\(`)) ?? source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\(`));
  if (!declaration || declaration.index === undefined) return null;

  const parametersOpen = source.indexOf("(", declaration.index);
  const parametersClose = matchingBracket(source, parametersOpen, "(", ")");
  if (parametersClose === -1) return null;

  const bodyOpen = source.indexOf("{", parametersClose);
  if (bodyOpen === -1) return null;
  const bodyClose = matchingBracket(source, bodyOpen, "{", "}");
  return source.slice(bodyOpen, bodyClose === -1 ? undefined : bodyClose);
}

/** `id="anchor-name"`. `data-testid` does not match — the preceding character
 * is a letter, not whitespace — and it is not an anchor anyway. */
const LITERAL_ID = /\sid="([a-z][a-z0-9-]*)"/g;

function literalIdsInRepeatedComponents(file: string): string[] {
  const source = stripSourceComments(readFileSync(file, "utf8"));
  const imports = componentImports(file, source);
  const found: string[] = [];

  for (const map of source.matchAll(/\.map\(/g)) {
    const callOpen = (map.index ?? 0) + map[0].length - 1;
    const callClose = matchingBracket(source, callOpen, "(", ")");
    if (callClose === -1) continue;
    const repeated = source.slice(callOpen, callClose);

    for (const tag of new Set([...repeated.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)].map((m) => m[1]))) {
      const sameFile = componentBody(source, tag);
      const imported = imports.get(tag);
      const body =
        sameFile ?? (imported ? componentBody(stripSourceComments(readFileSync(imported, "utf8")), tag) : null);
      if (body === null) continue;

      const where = sameFile ? path.relative(SRC, file) : path.relative(SRC, imported as string);
      for (const id of body.matchAll(LITERAL_ID)) {
        found.push(`${path.relative(SRC, file)} renders <${tag}> once per row, and ${where} gives it id="${id[1]}"`);
      }
    }
  }
  return found;
}

describe("an anchor inside a card that repeats", () => {
  it("carries the row's own id, so two rows are two anchors", () => {
    const files = shippedComponentFiles();
    // A derivation that reads nothing passes vacuously. This is the floor the
    // repo had when the guard was written; it only ever grows.
    expect(files.length, "no .tsx files were read — the walk is broken, not the repo clean").toBeGreaterThan(300);

    const duplicated = files.flatMap(literalIdsInRepeatedComponents).sort();

    expect(
      duplicated,
      "these components are rendered once per row and write a fixed id, so a second row puts two " +
        "elements with one id in the document — `getElementById` answers with whichever comes first and " +
        "every deep link lands on it. Interpolate the row's id, as `rtp-chapter-draft-assist.tsx` and " +
        "`close-loop-builder.tsx` do. Do not add an exemption list",
    ).toEqual([]);
  });
});
