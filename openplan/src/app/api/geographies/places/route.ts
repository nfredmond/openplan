import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { placeSearchResponseSchema } from "@/lib/api/place-geographies";
import { searchPlaces } from "@/lib/geographies/place-resolver";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

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
      // Parsed through the schema so every response carries the same coverage
      // fields — a client must never have to guess whether they were omitted.
      return NextResponse.json(placeSearchResponseSchema.parse({ items: [] }), { status: 200 });
    }

    // The county arm of searchPlaces resolves its Census API key through
    // censusApiKey(), which prefers the workspace's own Integration-keys entry
    // over the deployment env — but only when the call runs inside
    // withWorkspaceIntegrationContext. The deleted /api/geographies/counties
    // route was the only carrier of that seam (2026-08-03 cleanup), so a
    // workspace that had self-served a Census key was still told "this
    // deployment has not configured" one. Best-effort, exactly like the
    // census-tract ingest route: no workspace membership or a failed lookup
    // searches with the deployment env key rather than failing outright.
    const workspaceId = await loadCurrentWorkspaceMembership(supabase, user.id)
      .then(({ membership }) => membership?.workspace_id ?? null)
      .catch(() => null);
    const outcome = workspaceId
      ? await withWorkspaceIntegrationContext(workspaceId, () => searchPlaces(q, limit))
      : await searchPlaces(q, limit);
    const response = placeSearchResponseSchema.parse(outcome);

    audit.info("place_search_loaded", {
      userId: user.id,
      query: q,
      count: response.items.length,
      unavailableKinds: response.unavailableKinds,
      searchUnavailable: response.searchUnavailable,
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
