import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

/**
 * How many census tracts are loaded for one US county.
 *
 * The READ counterpart of the ingest route beside it, with the same auth rule
 * and the same reason: `census_tracts` is public, shared and cross-tenant, so
 * this is authenticated but deliberately not workspace-scoped. Loading a county
 * once makes its choropleth available to everyone who looks at it, and asking
 * how many are loaded reveals nothing about any workspace.
 *
 * It lives under /api/geographies rather than /api/map-features because that
 * namespace means "what THIS workspace's map draws", and this answers a question
 * about a county. Neither existing surface could answer it: the counts route
 * conflates "no workspace", "geography not set" and "kind unsupported" into a
 * single null and only ever reports the home county, and the census-tracts
 * feature route would ship up to 500 MultiPolygons to learn one integer.
 *
 * Read through the CALLER'S client. `census_tracts_map` already grants SELECT to
 * `authenticated` (20260422000068), so a public-data count needs no service-role
 * escalation and does not get one.
 */
export const runtime = "nodejs";

const querySchema = z.object({
  stateFips: z.string().regex(/^\d{2}$/),
  countyFips: z.string().regex(/^\d{3}$/),
});

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("geographies.census_tracts.coverage", request);

  try {
    const parsed = querySchema.safeParse({
      stateFips: request.nextUrl.searchParams.get("stateFips"),
      countyFips: request.nextUrl.searchParams.get("countyFips"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "A 2-digit state FIPS and 3-digit county FIPS are required." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { count, error } = await supabase
      .from("census_tracts_map")
      .select("geoid", { count: "exact", head: true })
      .eq("state_fips", parsed.data.stateFips)
      .eq("county_fips", parsed.data.countyFips);

    if (error) {
      audit.error("census_tract_coverage_failed", {
        userId: user.id,
        message: error.message,
        code: error.code ?? null,
      });
      // A county we cannot count is not a county with nothing in it, so this
      // must not answer 200 with a zero.
      return NextResponse.json(
        { error: "Could not read tract coverage for this county." },
        { status: 500 }
      );
    }

    /**
     * HOW MANY OF THOSE TRACTS PREDATE THE ACS UNIVERSE COLUMNS.
     *
     * A tract loaded before migration 20260805000010 has no `poverty_universe`,
     * so its poverty rate is not "0%" and not "the old number" — it is absent,
     * and the Title VI comparison leaves the tract out. That is the honest
     * answer, but on its own it is a dead end: nothing in the product told a
     * planner that loading the county again is what fixes it. This count is what
     * lets the coverage control say so.
     *
     * A FAILURE HERE DOES NOT FAIL THE REQUEST. The tract count above is the
     * answer to the question that was asked; this is an advisory alongside it.
     * `staleTractCount: null` means "not known", which the control renders as
     * silence rather than as a claim that every tract is current.
     */
    let staleTractCount: number | null = null;
    const stale = await supabase
      .from("census_tracts_map")
      .select("geoid", { count: "exact", head: true })
      .eq("state_fips", parsed.data.stateFips)
      .eq("county_fips", parsed.data.countyFips)
      .is("poverty_universe", null);

    if (stale.error) {
      audit.error("census_tract_universe_coverage_failed", {
        userId: user.id,
        message: stale.error.message,
        code: stale.error.code ?? null,
      });
    } else {
      staleTractCount = stale.count ?? 0;
    }

    return NextResponse.json(
      {
        stateFips: parsed.data.stateFips,
        countyFips: parsed.data.countyFips,
        tractCount: count ?? 0,
        staleTractCount,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("census_tract_coverage_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while reading tract coverage" }, { status: 500 });
  }
}
