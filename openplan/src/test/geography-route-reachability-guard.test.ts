import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * REGRESSION GUARD — a geography route that WRITES must be reachable from the
 * product, or be explicitly and reasonedly unreachable.
 *
 * THE DEFECT. `POST /api/geographies/census-tracts/ingest` shipped complete:
 * validated, authenticated, audited, tested. It had no caller anywhere in
 * `src/components` or `src/app/(app)`. So the equity-tract layer — one of the
 * layers the README advertises on the cartographic workbench — could not be
 * filled by anyone using the app. A new workspace anywhere in the United States
 * got an empty layer and no way to populate it, which is a self-serve defect
 * rather than a wording problem.
 *
 * A working write route with no way to reach it is not a smaller version of a
 * feature. It is a feature that does not exist, described by code that looks
 * like it does.
 *
 * This pins BOTH halves of the current arrangement: the tract ingest must stay
 * reachable, and the designation ingest must stay UNREACHABLE, because they are
 * gated differently on purpose.
 */

const API_GEOGRAPHIES = path.join(process.cwd(), "src", "app", "api", "geographies");
const UI_ROOTS = [
  path.join(process.cwd(), "src", "components"),
  path.join(process.cwd(), "src", "app", "(app)"),
];

/**
 * Routes that write and are deliberately NOT reachable from the interface.
 * The value is the reason, and it has to be a reason about AUTHORITY — not
 * about effort.
 */
const OPERATOR_ONLY_BY_DESIGN: Record<string, string> = {
  "equity-designation/ingest/route.ts":
    "OPERATOR-ONLY BY DESIGN. It writes caller-supplied disadvantaged-community FLAGS into a table " +
    "served to every workspace, so it is gated on OPENPLAN_EQUITY_INGEST_TOKEN and answers 403 when " +
    "that env is unset. Its own header spells out why 'authenticated' is not enough: sign-up is free " +
    "and ungated, so 'any signed-in user' means 'anyone', and this route decides which communities " +
    "are labelled disadvantaged. Giving it a UI would hand a stranger a cross-tenant reference-data " +
    "write. Do not 'fix' this by adding one.",
};

function walk(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function routeFiles(): string[] {
  return walk(API_GEOGRAPHIES).filter((file) => path.basename(file) === "route.ts");
}

function routeId(file: string): string {
  return path.relative(API_GEOGRAPHIES, file).split(path.sep).join("/");
}

/** Routes exporting a mutating verb. A GET-only route has nothing to reach. */
function writesData(source: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].some((verb) =>
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${verb}\\b`).test(source)
  );
}

const uiSources = UI_ROOTS.flatMap(walk)
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => readFileSync(file, "utf8"));

/** The fetch path the interface would use for this route. */
function apiPath(id: string): string {
  return `/api/geographies/${id.replace(/\/route\.ts$/, "")}`;
}

describe("geography write routes are reachable", () => {
  it("has a UI caller for every geography route that writes", () => {
    const unreachable = routeFiles()
      .filter((file) => writesData(readFileSync(file, "utf8")))
      .map(routeId)
      .filter((id) => !(id in OPERATOR_ONLY_BY_DESIGN))
      .filter((id) => !uiSources.some((source) => source.includes(apiPath(id))))
      .sort();

    expect(
      unreachable,
      "This geography route writes, and nothing under src/components or src/app/(app) calls it. A " +
        "write route with no way to reach it is not a smaller feature — it is a feature that does " +
        "not exist, described by code that looks like it does. Either give it an entry point, or " +
        "add it to OPERATOR_ONLY_BY_DESIGN with a reason about AUTHORITY."
    ).toEqual([]);
  });

  it("keeps the census-tract ingest reachable specifically", () => {
    // Named rather than left to the sweep above, because this is the one the
    // guard exists for: the equity layer is advertised on the public README.
    const ingest = "/api/geographies/census-tracts/ingest";
    const coverage = "/api/geographies/census-tracts/coverage";

    expect(uiSources.some((source) => source.includes(ingest))).toBe(true);
    // And the read that makes its result observable, rather than asserted.
    expect(uiSources.some((source) => source.includes(coverage))).toBe(true);
  });

  it("keeps the designation ingest UNreachable, and its gate intact", () => {
    // The other half of the invariant. This one must never gain an entry point.
    const designation = "/api/geographies/equity-designation/ingest";
    expect(uiSources.some((source) => source.includes(designation))).toBe(false);

    const source = readFileSync(
      path.join(API_GEOGRAPHIES, "equity-designation", "ingest", "route.ts"),
      "utf8"
    );
    expect(source).toContain("OPENPLAN_EQUITY_INGEST_TOKEN");
    expect(source).toContain("timingSafeEqual");
  });

  it("keeps the allowlist honest — no entry for a route that no longer writes", () => {
    const writing = new Set(
      routeFiles().filter((file) => writesData(readFileSync(file, "utf8"))).map(routeId)
    );
    const stale = Object.keys(OPERATOR_ONLY_BY_DESIGN).filter((id) => !writing.has(id));

    expect(stale).toEqual([]);
  });

  it("guards the guard", () => {
    const all = routeFiles();
    expect(all.length).toBeGreaterThan(3);
    expect(all.map(routeId)).toContain("census-tracts/ingest/route.ts");
    expect(uiSources.length).toBeGreaterThan(100);

    // The detector must discriminate: a GET-only route is not a write.
    expect(writesData("export async function GET() {}")).toBe(false);
    expect(writesData("export async function POST() {}")).toBe(true);
  });
});
