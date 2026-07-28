import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { countyGeographySearchResponseSchema } from "@/lib/api/county-geographies";
import { searchUsCounties } from "@/lib/geographies/us-counties";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

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

    // County search is the census front door, so the caller's workspace key
    // must reach it. The route itself is workspace-less; the user's current
    // workspace (active-workspace cookie, else sole membership) supplies the
    // integration scope. Resolution is best-effort on purpose: a user with no
    // workspace — or a failed lookup — searches with the deployment env key,
    // never a new failure mode for search itself.
    const workspaceId = await loadCurrentWorkspaceMembership(supabase, user.id)
      .then(({ membership }) => membership?.workspace_id ?? null)
      .catch(() => null);
    const runSearch = () => searchUsCounties(q, limit);
    const outcome = workspaceId
      ? await withWorkspaceIntegrationContext(workspaceId, runSearch)
      : await runSearch();
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
