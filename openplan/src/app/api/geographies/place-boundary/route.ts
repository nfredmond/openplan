import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { placeBoundaryResponseSchema, placeKindSchema } from "@/lib/api/place-geographies";
import { resolvePlaceBoundary } from "@/lib/geographies/place-resolver";

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("geographies.place_boundary.resolve", request);
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
    const kindResult = placeKindSchema.safeParse(searchParams.get("kind"));
    const geoid = (searchParams.get("geoid") ?? "").replace(/[^0-9]/g, "");

    if (!kindResult.success || geoid.length < 5 || geoid.length > 7) {
      return NextResponse.json({ error: "A valid kind and GEOID are required" }, { status: 400 });
    }

    const resolved = await resolvePlaceBoundary(kindResult.data, geoid);
    if (!resolved) {
      audit.warn("place_boundary_not_found", {
        userId: user.id,
        kind: kindResult.data,
        geoid,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "No boundary found for that place" }, { status: 404 });
    }

    const response = placeBoundaryResponseSchema.parse(resolved);

    audit.info("place_boundary_resolved", {
      userId: user.id,
      kind: response.kind,
      geoid: response.geoid,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    audit.error("place_boundary_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while resolving the place boundary" }, { status: 500 });
  }
}
