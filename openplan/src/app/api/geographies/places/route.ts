import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { placeSearchResponseSchema } from "@/lib/api/place-geographies";
import { searchPlaces } from "@/lib/geographies/place-resolver";

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("geographies.places.search", request);
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

    if (q.length < 2) {
      return NextResponse.json({ items: [] }, { status: 200 });
    }

    const items = await searchPlaces(q, limit);
    const response = placeSearchResponseSchema.parse({ items });

    audit.info("place_search_loaded", {
      userId: user.id,
      query: q,
      count: response.items.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    audit.error("place_search_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while searching places" }, { status: 500 });
  }
}
