import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { stripSourceComments } from "./helpers/source-text";

/**
 * A CLASS NAME IS NOT A STYLE.
 *
 * `openplan-inline-label` and `openplan-inline-label-muted` were referenced by
 * nine files and defined by no stylesheet (found 2026-08-13 while auditing
 * route callers). Every "Edit", "Cancel", "Reprice" and "Correct" control on
 * the invoicing surfaces, and the register's tab-like switches, rendered as
 * browser-default unstyled text — for as long as those files had existed.
 *
 * This guard was written to see whether that was one mistake or a class of
 * them. It was a class of them. On 2026-08-12 it found seventeen more names,
 * across 130-odd call sites: the whole metric-card family (`module-metric-card`
 * / `-label` / `-value`, 64 call sites carrying every fiscal-constraint figure
 * on the RTP cycle page), `module-inline-action` (53 sites), `module-row-card`,
 * `module-grid-layout` — which was the only thing supplying `display: grid` to
 * two page bodies, so their sidebars had never sat beside anything — and the
 * entire Mapbox popup family, which meant OpenPlan's one non-React surface was
 * still wearing the library's default white chrome.
 *
 * NOTHING IN THIS PROJECT COULD HAVE CAUGHT IT. TypeScript does not read CSS.
 * ESLint does not read CSS. The build does not warn about a selector that was
 * never written, because from the bundler's point of view nothing is wrong: a
 * `className` string is just a string. The unit tests render components and
 * assert on text and roles, not on computed style, and jsdom applies no
 * stylesheet anyway. The only thing that fails is a planner looking at the
 * screen — which is why this ran undetected across sixteen modules.
 *
 * So this guard reads the two artifacts and compares them. It covers the
 * project's OWN hand-written design-system prefixes only — `module-`,
 * `openplan-` and `op-` — because those are the ones a person writes into a
 * stylesheet by hand. Tailwind utilities are generated and are not in scope.
 *
 * COMMENTS ARE STRIPPED FROM BOTH SIDES. A stylesheet comment that names a
 * selector does not define it, and a component comment that names a class does
 * not ask for it. Letting prose reach either matcher has broken five guards in
 * this repo already (see `helpers/source-text.ts`); here it would have been
 * especially quiet, because the fix commit for a missing class naturally writes
 * that class's name into a comment explaining the fix.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");
const SRC_DIR = path.join(process.cwd(), "src");

/** The prefixes this project hand-authors. Tailwind's output is not ours. */
const OWNED_PREFIXES = ["module-", "openplan-", "op-"];

/**
 * Strings that LOOK like one of our class names and are not class names at all.
 *
 * The scan below reads every string literal rather than trying to recognise a
 * `className` position, which is the safe direction to be wrong in: an
 * over-broad scan produces a visible false positive that someone must answer
 * for, while an extractor clever enough to miss a real class attribute would
 * fail silently and prove nothing. The cost of that choice is this list, and
 * the list is only allowed to hold strings that are genuinely not classes.
 *
 * Every entry needs a reason naming where it comes from. "It was failing" is
 * not a reason. If you are tempted to add a name that IS on an element, define
 * it instead — that is the entire point of the guard.
 */
const NOT_A_CLASS_NAME: Record<string, string> = {
  "openplan-report":
    "download filename slug — `openplan-report-${id}.pdf` in the report export routes",
  "openplan-survey-grid-1":
    "FLIGHT_SNAPSHOT_SCHEMA_VERSION, the aerial flight-plan snapshot schema id",
  "openplan-bca-ts": "BCA_ENGINE_VERSION, recorded on benefit-cost runs for provenance",
  "openplan-planner-pack-ts": "CEQA_MEMO_ENGINE_VERSION, recorded on CEQA screening memos",
  "module-unavailable":
    "a CitedRunUnresolvedReason union member — why a cited run could not be read",
  "module-page-skeleton":
    "the data-testid on ModulePageSkeleton's root; its class is `module-page`",
};

/**
 * Real classes on real elements that deliberately carry no stylesheet rule.
 *
 * This list is dangerous and must stay tiny: "it is styled somewhere else" is
 * exactly the excuse that would let the original defect back in. It is for the
 * one case where a stylesheet rule would be a LIE — an element whose geometry is
 * computed at runtime and set inline, where a CSS copy of the static half would
 * be a second source of truth that drifts.
 */
const STYLED_INLINE: Record<string, string> = {
  "op-map-backdrop":
    "the fixed full-viewport map region in cartographic-map-backdrop.tsx; its " +
    "background is chosen at runtime (Mapbox vs the parchment gradient fallback) " +
    "and every other property is on the same inline style object",
  "op-map-backdrop__canvas":
    "the Mapbox container inside it; opacity and filter animate with load state " +
    "and with map-reading mode, so the whole style object is inline. Also the " +
    "selector cartographic-map-backdrop-token.test.tsx queries",
};

function walk(dir: string, match: (file: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      found.push(...walk(full, match));
      continue;
    }
    if (match(entry.name)) found.push(full);
  }
  return found;
}

/** Every class this project defines, across every stylesheet it ships. */
function definedClasses(): Set<string> {
  const defined = new Set<string>();
  for (const file of walk(APP_DIR, (name) => name.endsWith(".css"))) {
    const css = stripSourceComments(fs.readFileSync(file, "utf8"));
    for (const match of css.matchAll(/\.((?:module|openplan|op)-[a-z0-9_-]+)/gi)) {
      defined.add(match[1]);
    }
  }
  return defined;
}

/**
 * Every owned class a component asks for, and the files asking. Only string
 * literals are read: a class assembled at runtime is out of reach here, and
 * pretending otherwise would make this guard claim more than it checks.
 */
function referencedClasses(): Map<string, { files: Set<string>; sites: number }> {
  const referenced = new Map<string, { files: Set<string>; sites: number }>();
  const files = walk(SRC_DIR, (name) => name.endsWith(".tsx") || name.endsWith(".ts"));
  for (const file of files) {
    if (file.includes(`${path.sep}test${path.sep}`)) continue;
    const source = stripSourceComments(fs.readFileSync(file, "utf8"));
    for (const match of source.matchAll(
      /["'`]([^"'`\n]*\b(?:module|openplan|op)-[a-z0-9_-]+[^"'`\n]*)["'`]/gi
    )) {
      for (const token of match[1].split(/\s+/)) {
        if (!OWNED_PREFIXES.some((prefix) => token.startsWith(prefix))) continue;
        if (!/^[a-z0-9_-]+$/i.test(token)) continue;
        const seen = referenced.get(token) ?? { files: new Set<string>(), sites: 0 };
        seen.files.add(path.relative(process.cwd(), file));
        seen.sites += 1;
        referenced.set(token, seen);
      }
    }
  }
  return referenced;
}

const EXCUSED = { ...NOT_A_CLASS_NAME, ...STYLED_INLINE };

describe("a class name is not a style", () => {
  it("defines every design-system class the product asks for", () => {
    const defined = definedClasses();
    const undefinedClasses = [...referencedClasses().entries()]
      .filter(([token]) => !defined.has(token) && !(token in EXCUSED))
      .map(
        ([token, { files, sites }]) =>
          `${token} — ${sites} call site(s) in ${files.size} file(s), first: ${[...files][0]}`
      )
      .sort();

    expect(
      undefinedClasses,
      "These class names are written into components and defined in no stylesheet, " +
        "so the elements carrying them render unstyled. Define them, or stop asking for them."
    ).toEqual([]);
  });

  /**
   * An exception list rots the moment the thing it excuses is deleted or fixed,
   * and a rotted exception is a hole nobody can see. Both directions are checked
   * so the list can only shrink by being right.
   */
  it("keeps its exception lists honest", () => {
    const defined = definedClasses();
    const referenced = referencedClasses();
    const stale: string[] = [];

    for (const [token, reason] of Object.entries(EXCUSED)) {
      if (!reason.trim()) stale.push(`${token} — excused with no reason given`);
      if (!referenced.has(token)) {
        stale.push(`${token} — excused but nothing references it any more; delete the entry`);
      }
      if (defined.has(token)) {
        stale.push(`${token} — a stylesheet defines it now, so the exception is dead weight`);
      }
    }

    expect(stale, "the exception lists must shrink, never drift").toEqual([]);
    // Small on purpose. A long list is this guard being negotiated with.
    expect(Object.keys(EXCUSED).length).toBeLessThanOrEqual(10);
  });

  it("can tell a defined class from an undefined one", () => {
    // The negative control. Without it a broken extractor reports an empty
    // list and reads as a pass — the failure this repo has recorded more than
    // once, most recently as a mutation battery that could not fail.
    const defined = definedClasses();
    expect(defined.has("module-note")).toBe(true);
    expect(defined.has("openplan-inline-label")).toBe(true);
    expect(defined.has("module-metric-card")).toBe(true);
    expect(defined.has("op-map-popup__title")).toBe(true);
    expect(defined.has("module-note-that-nobody-ever-wrote")).toBe(false);
  });

  /**
   * The second negative control, for the comment stripping specifically. Both
   * stylesheets and components are full of prose naming these classes — the
   * block above `.module-metric-card` names it four times — so if stripping
   * silently stopped working, a class mentioned only in a comment would count
   * as defined and this guard would start excusing exactly what it exists to
   * catch. These two names appear in comments in the tree and in no selector
   * and on no element.
   */
  it("does not mistake prose for a stylesheet or for an element", () => {
    expect(definedClasses().has("module-page-backdrop-that-was-never-written")).toBe(false);

    const cssWithOnlyAComment = "/* .module-ghost is described here but never written */";
    expect(stripSourceComments(cssWithOnlyAComment)).not.toContain("module-ghost");

    const tsxWithOnlyAComment = '// this element used to carry "module-ghost-reference"';
    expect(stripSourceComments(tsxWithOnlyAComment)).not.toContain("module-ghost-reference");
  });

  it("reads real components, not an empty set", () => {
    const referenced = referencedClasses();
    expect(referenced.size).toBeGreaterThan(20);
    expect(referenced.has("openplan-inline-label")).toBe(true);
    // The families this guard was written over. If the scan ever stops seeing
    // these, it is seeing nothing.
    expect(referenced.get("module-metric-card")?.sites ?? 0).toBeGreaterThan(20);
    expect(referenced.get("module-inline-action")?.sites ?? 0).toBeGreaterThan(20);
  });
});
