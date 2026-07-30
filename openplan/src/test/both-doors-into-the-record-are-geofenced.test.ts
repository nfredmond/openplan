import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A RULE ENFORCED ON ONE OF TWO DOORS IS NOT A RULE — IT IS A CLAIM.
 *
 * A resident can put a location into a campaign's record two ways: a pin or a
 * shape on the comment map (`/api/engage/[shareToken]/submit`), and a
 * `map_point` answer inside a survey (`/api/engage/[shareToken]/survey/submit`).
 * Both are drawn on the same operator map and both feed the same spatial
 * screening.
 *
 * The consultation-area check was built inside the comment route, so for a while
 * a campaign with the check ON still accepted a survey location anywhere on
 * Earth — while the operator console promised "Only accept comments pinned
 * inside <area>" and the map above the survey question said the same thing to
 * the resident. Two people building the same feature each owned one door and
 * neither owned the seam.
 *
 * WHY THIS IS A FILE SCAN AND NOT A REQUEST TEST. The behaviour of each route is
 * tested where it lives, at length. What no request test can express is the
 * standing invariant: WHENEVER a third way to put a location into the record is
 * added, it must go through the same enforcement. This fails the build when a
 * public route learns to store a coordinate without calling it — including a
 * route that does not exist yet, which is the only kind this repo keeps
 * shipping unguarded.
 */

const APP = process.cwd();
const PUBLIC_ROUTES_DIR = path.join(APP, "src/app/api/engage");

/** The one implementation both doors must call. */
const ENFORCEMENT = "refuseSubmissionOutsideCampaignArea";

/**
 * Matched as a CALL, not a mention.
 *
 * The first version of this guard tested `source.includes(ENFORCEMENT)`, which
 * an unchanged import statement satisfies — so a route that imported the check
 * and never called it passed. Found by mutation: deleting the call left the
 * import behind and every assertion here stayed green, which is the same class
 * of empty test this file was written to prevent elsewhere.
 */
const ENFORCEMENT_CALL = new RegExp(`\\b${ENFORCEMENT}\\s*\\(`);

/**
 * A route that stores a resident-supplied location.
 *
 * Detected by what it WRITES rather than what it reads: a route that merely
 * returns existing pins to the portal has nothing to geofence, while one that
 * inserts a latitude, a longitude or a geometry is putting a new location into
 * the record and owes the check.
 */
function storesALocation(source: string): boolean {
  // Persistence is matched loosely on purpose. The comment route calls
  // `.insert(` directly; the survey route hands its answers to
  // `insertSurveyResponse`. A detector that only recognised the first spelling
  // would have missed the door that was actually unguarded — which is the whole
  // reason this file exists.
  const writes = /insert|upsert/i.test(source);
  const location = /\blatitude\b|\bgeometry\b|map_point/.test(source);
  return writes && location;
}

function routeFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

describe("both doors into the record are geofenced", () => {
  const routes = routeFiles(PUBLIC_ROUTES_DIR).map((file) => ({
    file: path.relative(APP, file),
    source: readFileSync(file, "utf8"),
  }));

  it("is scanning the public engagement routes it means to scan", () => {
    // Non-vacuity: a moved directory would make every assertion below pass by
    // finding nothing to check.
    expect(routes.length).toBeGreaterThan(3);
    expect(routes.map((route) => route.file)).toEqual(
      expect.arrayContaining([expect.stringContaining("engage/[shareToken]/submit/route.ts")])
    );
  });

  it("finds both known location doors", () => {
    const storing = routes.filter((route) => storesALocation(route.source)).map((route) => route.file);

    expect(storing).toEqual(
      expect.arrayContaining([
        expect.stringContaining("engage/[shareToken]/submit/route.ts"),
        expect.stringContaining("engage/[shareToken]/survey/submit/route.ts"),
      ])
    );
  });

  it("makes every public route that stores a location call the same check", () => {
    const unguarded = routes
      .filter((route) => storesALocation(route.source) && !ENFORCEMENT_CALL.test(route.source))
      .map((route) => route.file);

    expect(
      unguarded,
      [
        "These public routes store a resident-supplied location and never call",
        `\`${ENFORCEMENT}\`.`,
        "",
        "A campaign that has turned on its consultation-area check is telling",
        "residents — on the operator console and on the map itself — that input",
        "outside the area is not accepted. A route that stores a location without",
        "asking makes that sentence false.",
        "",
        "Call it from `@/lib/engagement/geofence-enforcement`. Do not write a",
        "second implementation: the point of the shared module is that the two",
        "doors cannot drift apart.",
      ].join("\n")
    ).toEqual([]);
  });

  it("keeps one implementation of the check, not one per door", () => {
    // The enforcement reads the flag, resolves the place of record, and decides
    // when the expensive boundary read is worth doing. A second copy would
    // eventually disagree with the first about which of those it does.
    const definitions = routes.filter((route) =>
      new RegExp(`(async )?function ${ENFORCEMENT}\\b`).test(route.source)
    );

    expect(definitions.map((route) => route.file)).toEqual([]);
  });
});
