import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { ingestCensusTractsForCounty } from "@/lib/data-sources/census-tract-ingest";

// TIGERweb + ACS fetch per county, paged, plus one upsert per tract — beyond the
// default budget for a metropolitan county.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Populate `census_tracts` (public data) for the requested US counties.
 *
 * Authenticated, because it drives our server against TIGERweb and ACS — but not
 * workspace-scoped, because the data itself is public and shared: loading a
 * county once makes its equity choropleth available to everyone who looks at it.
 * The county filter is jurisdiction-neutral state+county FIPS; the adapter, not
 * this route, owns any single-source specifics.
 */
const ingestSchema = z.object({
  counties: z
    .array(
      z.object({
        stateFips: z.string().regex(/^\d{2}$/),
        countyFips: z.string().regex(/^\d{3}$/),
      })
    )
    .min(1)
    .max(8),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("geographies.census-tracts.ingest", request);
  const startedAt = Date.now();

  try {
    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = ingestSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid census-tract ingest parameters" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // De-duplicate requested counties so a caller cannot multiply the work.
    const uniqueCounties = Array.from(
      new Map(parsed.data.counties.map((c) => [`${c.stateFips}${c.countyFips}`, c])).values()
    );

    const service = createServiceRoleClient();
    const results = [];
    for (const county of uniqueCounties) {
      results.push(
        await ingestCensusTractsForCounty(service, {
          stateFips: county.stateFips,
          countyFips: county.countyFips,
        })
      );
    }

    const tractsUpserted = results.reduce((sum, r) => sum + r.tractsUpserted, 0);
    audit.info("census_tract_ingest_finished", {
      userId: user.id,
      counties: uniqueCounties.length,
      tractsUpserted,
      durationMs: Date.now() - startedAt,
    });

    // Per-county outcomes are honest: a caller can see which counties had no
    // published tract demographics vs which failed vs which loaded.
    return NextResponse.json({ results, tractsUpserted }, { status: 200 });
  } catch (error) {
    audit.error("census_tract_ingest_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while ingesting census tracts" }, { status: 500 });
  }
}
