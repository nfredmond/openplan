import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { ingestCensusTractsForCounty } from "@/lib/data-sources/census-tract-ingest";
import { reserveCensusTractIngest } from "@/lib/data-sources/census-tract-ingest-limit";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { VIEWER_READ_ONLY_MESSAGE } from "@/lib/auth/workspace-write-gate";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

// TIGERweb + ACS fetch per county, paged, plus one upsert per tract — beyond the
// default budget for a metropolitan county.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Populate `census_tracts` (public data) for the requested US counties.
 *
 * The rows are public and shared: loading a county once makes its equity
 * choropleth available to every workspace. The write still runs as the service
 * role against TIGERweb and ACS, so it is gated twice. The caller must be able
 * to change their current workspace (the matrix's `analysis.create` tier, which
 * excludes viewers), because planners start a load from the workspace geography
 * panel and the project place editor while setting up a study. And each person
 * is metered by `reserveCensusTractIngest`, a database-counted allowance, since
 * anyone who signs up owns a workspace. An operator token, as on the equity
 * ingest route, would take the button away from the planners who use it.
 * The county filter is jurisdiction-neutral state+county FIPS; the adapter, not
 * this route, owns any single-source specifics.
 */
const CENSUS_TRACT_INGEST_ACTION = "analysis.create";
const CENSUS_TRACT_INGEST_ROUTE = "/api/geographies/census-tracts/ingest";
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

    // The current workspace is both the permission subject and the Census key
    // scope. A failed lookup refuses rather than loading without a role check.
    const lookup = await loadCurrentWorkspaceMembership(supabase, user.id)
      .then(({ membership }) => ({ ok: true as const, membership }))
      .catch(() => ({ ok: false as const, membership: undefined }));
    if (!lookup.ok) {
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    const membership = lookup.membership;
    if (!membership) {
      return NextResponse.json({ error: "Join or create a workspace to load census tracts" }, { status: 403 });
    }
    if (!canAccessWorkspaceAction(CENSUS_TRACT_INGEST_ACTION, membership.role)) {
      return NextResponse.json({ error: VIEWER_READ_ONLY_MESSAGE }, { status: 403 });
    }
    const workspaceId = membership.workspace_id;

    const service = createServiceRoleClient();
    const reservation = await reserveCensusTractIngest(service, {
      userId: user.id,
      workspaceId,
      counties: uniqueCounties,
      sourceRoute: CENSUS_TRACT_INGEST_ROUTE,
    });
    if (reservation.status === "unavailable") {
      audit.error("census_tract_ingest_limit_unavailable", { userId: user.id, message: reservation.message });
      return NextResponse.json(
        { error: "Could not check the census tract load limit, so nothing was loaded. Try again." },
        { status: 503 }
      );
    }
    if (reservation.status === "refused") {
      const minutes = Math.max(1, Math.ceil(reservation.retryAfterSeconds / 60));
      return NextResponse.json(
        {
          error:
            `You have loaded ${reservation.recent} counties in the last hour; the limit is ${reservation.limit}. ` +
            `Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        },
        { status: 429, headers: { "Retry-After": String(reservation.retryAfterSeconds) } }
      );
    }

    const runIngest = async () => {
      const collected = [];
      for (const county of uniqueCounties) {
        collected.push(
          await ingestCensusTractsForCounty(service, {
            stateFips: county.stateFips,
            countyFips: county.countyFips,
          })
        );
      }
      return collected;
    };

    // The ACS half of this ingest goes through `withCensusApiKey`, which resolves
    // the workspace's own Census key. Without this context it silently used the
    // deployment env key instead, so a workspace that had self-served a key
    // under Integration keys still ingested without it, and the "add a Census
    // API key" remedy this route's failures point at was not actually true.
    const results = await withWorkspaceIntegrationContext(workspaceId, runIngest);

    const tractsUpserted = results.reduce((sum, r) => sum + r.tractsUpserted, 0);
    audit.info("census_tract_ingest_finished", {
      userId: user.id,
      workspaceId,
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
