import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `route.ts` MAY EXPORT ONLY WHAT NEXT.JS ALLOWS A ROUTE TO EXPORT.
 *
 * WHY THIS EXISTS AS A UNIT TEST. Next.js checks a route module's exports
 * against a generated type and fails the build with
 * `"<name>" is not a valid Route export field`. That check lives in `next
 * build` and NOWHERE ELSE: `npx tsc --noEmit` passes, `npm run lint` passes,
 * and all 5,800 tests pass, because the constraint is a framework rule rather
 * than a TypeScript one. It shipped exactly that way on 2026-08-03 — the survey
 * export route exported two `buildSurveyRegister*` helpers for readability,
 * nothing imported them, every gate short of the build was green, and the
 * build was the last thing anyone ran.
 *
 * `npm run build` takes minutes and only `qa:gate` runs it. This takes
 * milliseconds and runs on every `npm test`, which is where the feedback
 * belongs.
 *
 * WHAT TO DO INSTEAD OF EXPORTING. A helper that genuinely needs a direct
 * import moves to a sibling module (`_register.ts`, `_helpers.ts` — the
 * underscore keeps Next.js from treating it as a route). A helper that only
 * needs testing is tested by driving the handler, which is what these suites
 * already do.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");

/**
 * Everything Next.js accepts from a Route Handler module: the HTTP verbs, and
 * the route segment config. Derived from the framework contract, not from what
 * this repo happens to use — a route adopting `revalidate` tomorrow is
 * legitimate and must not have to edit this list.
 */
const ALLOWED_ROUTE_EXPORTS = new Set([
  // Handlers
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  // Route segment config
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "generateStaticParams",
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" || entry === "route.tsx" ? [full] : [];
  });
}

/**
 * Value exports declared in a route file. Type-only exports are erased before
 * the framework ever sees them, so they are not the defect and are skipped.
 */
function valueExportNames(source: string): string[] {
  const names: string[] = [];

  // export [async] function NAME / export const|let|var NAME / export class NAME
  const declaration =
    /^export\s+(?!type\b|interface\b)(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of source.matchAll(declaration)) {
    names.push(match[1]);
  }

  // export default …
  if (/^export\s+default\b/m.test(source)) names.push("default");

  // export { a, b as c } — the EXPORTED name is what the framework sees.
  const list = /^export\s+(?!type\b)\{([^}]*)\}/gm;
  for (const match of source.matchAll(list)) {
    for (const part of match[1].split(",")) {
      const piece = part.trim();
      if (!piece || piece.startsWith("type ")) continue;
      const asName = piece.split(/\s+as\s+/)[1] ?? piece;
      names.push(asName.trim());
    }
  }

  return names;
}

describe("a route file exports only route handlers", () => {
  it("declares nothing next build would reject as an invalid Route export field", () => {
    const offenders: string[] = [];

    for (const file of routeFiles(APP_DIR)) {
      const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
      for (const name of valueExportNames(readFileSync(file, "utf8"))) {
        if (!ALLOWED_ROUTE_EXPORTS.has(name)) {
          offenders.push(`${relative}: ${name}`);
        }
      }
    }

    expect(
      offenders,
      "next build rejects these: a route.ts may export only HTTP handlers and route segment config. " +
        "Move the helper to a sibling module (e.g. _helpers.ts) and import it, or make it module-private " +
        "and test it by driving the handler.",
    ).toEqual([]);
  });

  /**
   * The assertion above passes trivially if the scan finds no files or the
   * export pattern stops matching — which is how a guard quietly becomes
   * decoration. This is the floor.
   */
  it("guards the guard — the scan reaches real routes and the pattern still matches", () => {
    const files = routeFiles(APP_DIR);
    expect(files.length).toBeGreaterThan(80);

    expect(valueExportNames("export async function GET() {}")).toEqual(["GET"]);
    expect(valueExportNames("export function buildThing() {}")).toEqual(["buildThing"]);
    expect(valueExportNames("export const runtime = 'nodejs';")).toEqual(["runtime"]);
    expect(valueExportNames("export { GET, helper as POST };")).toEqual(["GET", "POST"]);
    // Type-only exports are erased and are not what the framework rejects.
    expect(valueExportNames("export type RouteContext = { a: 1 };")).toEqual([]);
    expect(valueExportNames("export type { Foo };")).toEqual([]);
    // A non-exported helper is fine and must not be reported.
    expect(valueExportNames("function buildThing() {}")).toEqual([]);
  });
});
