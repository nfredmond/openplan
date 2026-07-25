import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { countyGeographySearchResponseSchema } from "@/lib/api/county-geographies";
import { searchUsCounties } from "@/lib/geographies/us-counties";

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("geographies.counties.search", request);
  const startedAt = Date.now();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 8), 1), 20);

    if (!q || (q.length < 2 && !/^\d{5}$/.test(q))) {
      // Parsed through the schema so every response carries the same coverage
      // fields — a client must never have to guess whether they were omitted.
      return NextResponse.json(countyGeographySearchResponseSchema.parse({ items: [] }), { status: 200 });
    }

    const outcome = await searchUsCounties(q, limit);
    const response = countyGeographySearchResponseSchema.parse({
      items: outcome.items,
      catalogUnavailable: outcome.availability === "unavailable",
      unavailableReason: outcome.unavailableReason,
    });

    audit.info("county_search_loaded", {
      userId: user.id,
      query: q,
      count: response.items.length,
      catalogUnavailable: response.catalogUnavailable,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    audit.error("county_search_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while searching counties" }, { status: 500 });
  }
}
