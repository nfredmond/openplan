/**
 * THREE PUBLIC DOORS, ONE COMMENT FORM.
 *
 * ═══════════════════════════════════ THE DEFECT THIS EXISTS TO STOP COMING BACK
 *
 * Between the map-first rebuild and 2026-08-14 there were TWO implementations of
 * the form a member of the public fills in, and both were reachable by the
 * public:
 *
 *   `/engage/<token>`        → the guided rail beside the full-screen map
 *   `/engage/<token>/about`  → `SubmissionForm`, a stacked wall of seven fields
 *   `/embed/<token>`         → the same stacked form, inside an iframe
 *
 * Every difference between them fell on the older one, and every one of them was
 * a difference a resident feels rather than one an operator can see:
 *
 *   - an API refusal ("Invalid submission") shown in English to a Spanish reader
 *     instead of the catalog's own sentence;
 *   - an empty comment allowed to reach the server, which is what produced that
 *     refusal in the first place;
 *   - its own copy of the two-step photo flow and the demographics shape rather
 *     than `submitPortalInput`, so a title of three spaces was stored as three
 *     spaces;
 *   - the map's framing printed as English prose composed server-side.
 *
 * This repository has a recorded name for the shape: a shared capability living
 * inside one of its two callers gets reimplemented, wrongly, by the other. The
 * fix is not to keep two forms in step. It is for there to be one.
 *
 * ══════════════════════════════════════════ WHY IT IS DERIVED, NOT LISTED
 *
 * A test that named three route files and one component file would pass forever
 * after somebody added a FOURTH public door — which is exactly how the second
 * implementation survived: nothing enumerated the doors. So:
 *
 *   - the doors come from the FILESYSTEM (every `page.tsx` under the public
 *     participant route groups), so a new one is in scope the moment it exists;
 *   - "a submission form" is recognised by what it DOES — renders a `<form>` and
 *     writes to the resident-submission endpoint, whether directly or through
 *     the shared submit path — not by its filename;
 *   - the endpoint itself is read off the API route's own directory on disk, so
 *     renaming the route makes this guard fail rather than go quiet.
 *
 * ══════════════════════════════════════════════ WHAT THIS FILE CANNOT PROVE
 *
 * It is a STATIC IMPORT-GRAPH walk over source text, and it inherits every
 * blindness of that method:
 *
 *   - it cannot see a form reached by `next/dynamic`, a string-keyed registry,
 *     or any other indirection that is not a literal `import`;
 *   - it cannot tell a form a resident can REACH from one rendered behind a
 *     condition nobody meets — a second form on a tab that never opens is
 *     invisible here and needs a test that renders the surface;
 *   - it cannot see whether the one form is CORRECT, only that there is one of
 *     it. What it renders is `public-engagement-portal.test.tsx`,
 *     `portal-rail-refuses-an-empty-comment.test.tsx` and
 *     `public-engagement-page.test.tsx`;
 *   - jsdom is not involved at all, so nothing here is evidence about layout,
 *     visibility, or anything a person could see.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "@/test/helpers/source-text";

const SRC = path.join(process.cwd(), "src");

/**
 * The route groups whose pages are served to a member of the public with no
 * account. Directory names, because Next.js route groups ARE directories — a
 * fourth public group would be a new directory here and would have to be added
 * deliberately, which is the point.
 */
const PUBLIC_PARTICIPANT_ROUTE_GROUPS = ["app/(portal)", "app/(embed)"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Source with every comment blanked — a paragraph ABOUT the code is not the code. */
function code(absolute: string): string {
  return stripSourceComments(readFileSync(absolute, "utf8"));
}

const relative = (absolute: string) =>
  path.relative(SRC, absolute).split(path.sep).join("/");

/**
 * THE ENDPOINT A RESIDENT'S COMMENT IS WRITTEN TO, read off the API route's own
 * directory rather than typed here.
 *
 * `/api/engage/[shareToken]/submit` on disk becomes the fetch shape a client
 * writes: `` `/api/engage/${…}/submit` ``. Deriving it means renaming or moving
 * the route breaks this file loudly instead of leaving it matching nothing —
 * which is the failure mode of every guard that greps for a literal.
 *
 * The trailing boundary matters: `/api/engage/${token}/survey/submit` is the
 * SURVEY's endpoint, a different form with a different shape, and it must not be
 * swept in here.
 */
const SUBMIT_ROUTE_DIR = path.join(SRC, "app/api/engage/[shareToken]/submit");
const SUBMIT_ENDPOINT_PATTERN = /\/api\/engage\/\$\{[^}]+\}\/submit["'`]/;

/**
 * The one shared submit path. Its own filename is derived from the module that
 * exports it, so a rename moves this with it.
 */
const SHARED_SUBMIT_MODULE = path.join(SRC, "lib/engagement/submit-portal-input.ts");
const SHARED_SUBMIT_EXPORT = "submitPortalInput";

/**
 * A module that IS a resident submission form: it renders a `<form>` and that
 * form's submission reaches the endpoint above — directly, or through the shared
 * path.
 *
 * BOTH ROUTES TO THE ENDPOINT COUNT, and that is the load-bearing part. Checking
 * only for `submitPortalInput` would call a hand-rolled second copy "not a
 * submission form" precisely because it skipped the shared path, which is the
 * defect this file is about. Checking only for the endpoint would miss the real
 * one, which no longer names it.
 */
function isResidentSubmissionForm(source: string): boolean {
  const rendersForm = /<form[\s>]/.test(source);
  if (!rendersForm) return false;
  return SUBMIT_ENDPOINT_PATTERN.test(source) || source.includes(SHARED_SUBMIT_EXPORT);
}

/** `@/x` and `./x` → an absolute file under `src`, or null when it resolves outside. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every module a route file can reach through literal `import`s, transitively.
 *
 * `import type` lines are NOT excluded, and that is deliberate: a type-only
 * import cannot render a form, so including it costs nothing, while writing the
 * exclusion wrong would silently shrink the graph — and a graph that quietly
 * stops reaching things is the shape of a guard that proves nothing.
 */
function reachableModules(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);

    const source = code(current);
    for (const match of source.matchAll(/(?:^|\s)(?:import|export)\b[^;]*?from\s*["']([^"']+)["']/g)) {
      const resolved = resolveImport(current, match[1]);
      if (resolved) queue.push(resolved);
    }
    // `const x = await import("…")` and `dynamic(() => import("…"))`.
    for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      const resolved = resolveImport(current, match[1]);
      if (resolved) queue.push(resolved);
    }
  }

  return seen;
}

const publicDoors = PUBLIC_PARTICIPANT_ROUTE_GROUPS.flatMap((group) =>
  walk(path.join(SRC, group)).filter((file) => path.basename(file) === "page.tsx")
);

/** For each door: which submission-form modules it can reach. */
const formsByDoor = new Map<string, string[]>(
  publicDoors.map((door) => [
    relative(door),
    [...reachableModules(door)]
      .filter((file) => isResidentSubmissionForm(code(file)))
      .map(relative)
      .sort(),
  ])
);

describe("the three public doors render one submission form", () => {
  /**
   * NEGATIVE CONTROLS FIRST. Every assertion below is about a set; a walker that
   * silently stopped resolving imports, or a detector that stopped matching,
   * would make all of them pass with empty sets. These are the tests that would
   * fail in that case.
   */
  it("finds the endpoint, the shared submit path, and the public doors it is about", () => {
    expect(existsSync(SUBMIT_ROUTE_DIR), `no submit route at ${SUBMIT_ROUTE_DIR}`).toBe(true);
    expect(existsSync(SHARED_SUBMIT_MODULE)).toBe(true);
    expect(code(SHARED_SUBMIT_MODULE)).toMatch(SUBMIT_ENDPOINT_PATTERN);

    /*
      THE THREE DOORS ARE READ OFF DISK. Asserting a floor rather than an exact
      count on purpose: a fourth public participant page is a thing somebody may
      legitimately add, and when they do it is picked up by the assertions below
      rather than by this one. What must never happen is this list going EMPTY,
      which is what a moved route group or a broken walk looks like.
    */
    expect(publicDoors.length).toBeGreaterThanOrEqual(3);
    const doorPaths = [...formsByDoor.keys()];
    expect(doorPaths).toContain("app/(portal)/engage/[shareToken]/page.tsx");
    expect(doorPaths).toContain("app/(portal)/engage/[shareToken]/about/page.tsx");
    expect(doorPaths).toContain("app/(embed)/embed/[shareToken]/page.tsx");
  });

  /**
   * THE CLAIM. Not "these three files import that one file" — that is a list —
   * but "no door can reach a second implementation", which is what actually
   * regressed.
   */
  it("gives every public door exactly one submission form, and the same one", () => {
    for (const [door, forms] of formsByDoor) {
      expect(forms, `${door} reaches no submission form at all`).not.toHaveLength(0);
      expect(forms, `${door} can reach ${forms.length} submission forms: ${forms.join(", ")}`).toHaveLength(1);
    }

    const distinct = new Set([...formsByDoor.values()].map((forms) => forms[0]));
    expect(
      [...distinct],
      "The public doors do not render the same submission form.\n" +
        "Two implementations of one resident-facing form is the defect this file exists for:\n" +
        "the one fewer people look at falls behind, in the language and the payload, silently."
    ).toHaveLength(1);
  });

  /**
   * AND THERE IS ONLY ONE IN THE REPOSITORY AT ALL.
   *
   * The assertion above would stay green if somebody built a second
   * implementation and left it unreachable — which is this repository's OTHER
   * most repeated defect, and the state the second form spent its last week in.
   * A component that writes a resident's comment and nothing renders is not a
   * spare: it is the next door's implementation, waiting.
   */
  it("has no second implementation anywhere in the source tree", () => {
    const everywhere = walk(SRC)
      .filter((file) => file.endsWith(".tsx") && !file.includes(`${path.sep}test${path.sep}`))
      .filter((file) => isResidentSubmissionForm(code(file)))
      .map(relative)
      .sort();

    const reachable = [...new Set([...formsByDoor.values()].flat())].sort();
    const unreachable = everywhere.filter((file) => !reachable.includes(file));

    expect(
      unreachable,
      "A component writes a resident's comment and no public door renders it.\n" +
        "An unreachable submission form is not a spare — it is the next door's implementation,\n" +
        "waiting, and it will be wired up by somebody who does not know the first one exists.\n" +
        "Wire it up or delete it; git history is the archive."
    ).toEqual([]);
    // The mirror direction, so this cannot pass by the walk finding nothing at all.
    expect(everywhere).toEqual(reachable);
  });
});
