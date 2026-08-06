import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAP_FEATURE_LAYER_LIMIT,
  POSTGREST_MAX_ROWS_PER_REQUEST,
  PROJECT_AREA_LAYER_LIMIT,
  TRANSIT_STOP_LAYER_LIMIT,
  layerLimitNeedsPaging,
} from "@/lib/cartographic/layer-disclosure";

/**
 * A MAP LAYER MAY NOT NAME A CAP THE PLATFORM WILL NOT HONOUR.
 *
 * PostgREST returns at most `max_rows` rows however large a `.limit()` it is
 * handed — 1,000 in this deployment — and it does so SILENTLY: no error, no
 * warning, nothing in the response saying anything was withheld. So a layer that
 * asks for more than that and does not page gets truncated by the server while
 * its own disclosure goes on reporting the larger number.
 *
 * THAT IS NOT HYPOTHETICAL AND IT IS THE REASON THIS FILE EXISTS. The transit
 * stop layer shipped declaring `TRANSIT_STOP_LAYER_LIMIT = 5000`, without
 * paging. Replayed against a real database with Sacramento Regional Transit's
 * real feed it returned **1,000 of 2,821** matched stops and reported
 * `limit: 5000` in the disclosure — a false statement on the one surface whose
 * entire purpose is telling a planner what was left out. It also falsified the
 * measured argument for the cap in the first place: "a mid-size agency is drawn
 * whole" is only true if the whole agency arrives.
 *
 * WHY NOTHING CAUGHT IT. Every map-layer test in this repository drives a mocked
 * Supabase client, which returns its fixture regardless of what `.limit()` said.
 * The ceiling is imposed by the SERVER, so it is invisible to the entire suite by
 * construction — the same shape as the hex-EWKB geometry trap, and the same
 * lesson: where the database is the claim, check the database.
 *
 * WHAT THIS GUARD DOES INSTEAD. It cannot reach a database, so it does not try
 * to. It asserts the RELATIONSHIP: any layer cap above the platform ceiling must
 * belong to a route that pages. That is a cheap, build-time, deterministic
 * check, and it is the one that would have caught the defect at the moment
 * `* 10` was written.
 *
 * WHY THE CEILING IS NOT SIMPLY RAISED. `max_rows` is a GLOBAL PostgREST setting
 * affecting every route in a deployment, and a hosted Supabase project carries
 * its own value this repository does not control. Raising it here would work
 * locally and truncate differently in production — a limit that varies by
 * deployment is one no disclosure can state, which is worse than the bug.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");
const MAP_FEATURES_DIR = path.join(APP_DIR, "api", "map-features");
const CONFIG_TOML = path.join(process.cwd(), "supabase", "config.toml");

/** Every declared layer cap, by the name a failure should name. */
const LAYER_CAPS: ReadonlyArray<{ name: string; limit: number }> = [
  { name: "MAP_FEATURE_LAYER_LIMIT", limit: MAP_FEATURE_LAYER_LIMIT },
  { name: "PROJECT_AREA_LAYER_LIMIT", limit: PROJECT_AREA_LAYER_LIMIT },
  { name: "TRANSIT_STOP_LAYER_LIMIT", limit: TRANSIT_STOP_LAYER_LIMIT },
];

function mapFeatureRoutes(): Array<{ layer: string; source: string }> {
  return readdirSync(MAP_FEATURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      layer: entry.name,
      file: path.join(MAP_FEATURES_DIR, entry.name, "route.ts"),
    }))
    .filter((entry) => {
      try {
        readFileSync(entry.file, "utf8");
        return true;
      } catch {
        return false;
      }
    })
    .map((entry) => ({ layer: entry.layer, source: readFileSync(entry.file, "utf8") }));
}

/** A route pages when it reads by `.range(`. `.limit(` alone cannot exceed the ceiling. */
function pages(source: string): boolean {
  return /\.range\s*\(/.test(source);
}

describe("a map layer cannot name a cap the platform will not honour", () => {
  /**
   * NON-VACUITY. Every assertion below is over a discovered list, and a list
   * that came back empty would pass all of them for the wrong reason.
   */
  it("finds the caps and the routes it is about to reason over", () => {
    const routes = mapFeatureRoutes();

    expect(LAYER_CAPS.length).toBeGreaterThanOrEqual(3);
    expect(routes.length).toBeGreaterThanOrEqual(8);
    expect(routes.map((route) => route.layer)).toContain("transit");
    expect(routes.map((route) => route.layer)).toContain("crashes");

    // And the predicate can tell the two shapes apart, or the whole file is
    // asserting a constant against itself.
    expect(pages("await q.range(0, 999)")).toBe(true);
    expect(pages("await q.limit(500)")).toBe(false);
  });

  it("keeps the declared ceiling equal to what the database is actually configured with", () => {
    // The mechanical cross-reference: `POSTGREST_MAX_ROWS_PER_REQUEST` is a
    // TypeScript constant asserting a fact about the database's configuration,
    // and the two can drift silently in either direction. `supabase/config.toml`
    // is the tracked artifact that decides it locally.
    const config = readFileSync(CONFIG_TOML, "utf8");
    const declared = /^\s*max_rows\s*=\s*(\d+)/m.exec(config);

    expect(declared, "supabase/config.toml must declare max_rows").not.toBeNull();
    expect(
      Number(declared?.[1]),
      "POSTGREST_MAX_ROWS_PER_REQUEST no longer matches supabase/config.toml's max_rows. A layer " +
        "cap is checked against the constant, so a drift here makes every assertion below reason " +
        "about a ceiling the database does not have."
    ).toBe(POSTGREST_MAX_ROWS_PER_REQUEST);
  });

  it("pages every route whose layer cap exceeds one response", () => {
    const routes = new Map(mapFeatureRoutes().map((route) => [route.layer, route.source]));

    const offenders: string[] = [];
    for (const cap of LAYER_CAPS) {
      if (!layerLimitNeedsPaging(cap.limit)) continue;
      // The transit layer is the only cap above the ceiling today; the mapping
      // is by name so a new one has to be added here deliberately.
      const source = routes.get("transit");
      if (!source || !pages(source)) {
        offenders.push(`${cap.name} = ${cap.limit} exceeds ${POSTGREST_MAX_ROWS_PER_REQUEST} and its route does not page`);
      }
    }

    expect(
      offenders,
      "A layer declares a cap larger than one PostgREST response and reads it in a single request. " +
        "The server truncates silently at max_rows, so the layer draws fewer features than its own " +
        "disclosure claims — and the disclosure is the surface a planner trusts to say what is " +
        "missing. Either page the read with `.range()`, or lower the cap to the ceiling."
    ).toEqual([]);
  });

  it("keeps every other layer under the ceiling, so this stays a one-layer question", () => {
    // Not a rule that caps must be small — a statement of where things stand, so
    // that raising one becomes a decision rather than an accident. If this fails,
    // the layer it names needs paging and its own line in the test above.
    const overCeiling = LAYER_CAPS.filter((cap) => layerLimitNeedsPaging(cap.limit)).map((cap) => cap.name);

    expect(overCeiling).toEqual(["TRANSIT_STOP_LAYER_LIMIT"]);
  });
});
