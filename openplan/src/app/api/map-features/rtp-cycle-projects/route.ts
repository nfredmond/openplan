/**
 * The projects programmed in ONE RTP cycle, as a map layer.
 *
 * WHY THIS IS NOT `/api/map-features/rtp-cycles`. That route draws a pin per
 * CYCLE, from `rtp_cycles.anchor_latitude/longitude` — columns whose own
 * migration (20260422000067) calls them display-only and "not a spatial-query
 * index". A cycle anchor is one dot for a whole plan; it cannot answer "where
 * is the money going?", which is the question a board asks of a project list.
 * So nothing here reads the anchor. Geometry comes from the PROJECT's own
 * `latitude`/`longitude` (20260421000065) — the project SITE, deliberately kept
 * distinct from `place_geometry_geojson`, which is the AREA the work studies
 * (20260728000009) and belongs to `/api/map-features/project-areas`.
 *
 * WHY A PROJECT WITH NO LOCATION IS COUNTED RATHER THAN SKIPPED. This is the
 * whole reason the response is not a bare FeatureCollection. A cycle with 20
 * projects of which 6 have never had a site recorded would otherwise draw 14
 * dots, and a map that draws 14 dots asserts that 14 is the programme. Nothing
 * on screen would contradict it. `withoutGeometry` is what lets the panel say
 * "6 of 20 projects have no location recorded" — the same defect class the
 * shared `MapLayerDisclosure` contract was extracted for, applied to the one
 * kind of absence that contract cannot express (a row that was fetched, is
 * perfectly valid, and simply has no point).
 *
 * `withoutReadableProject` is separated from it on purpose. "No location
 * recorded" is a statement about the agency's own data entry; "the project row
 * behind this link could not be read" is a statement about the database. A
 * planner can act on the first and only an operator can act on the second, so
 * folding them together would send the wrong person looking.
 *
 * SCOPING. The cycle id arrives as a query parameter and is NEVER trusted: the
 * caller's workspace comes from their own membership, the cycle lookup is
 * filtered by it, and a cycle in another workspace is therefore not-found
 * rather than found-and-refused — the same posture the horizon-band routes
 * take, and for the same reason (a distinguishable 403 confirms the existence
 * of other workspaces' cycles to anyone iterating uuids).
 *
 * WHY NO MEMBERSHIP IS A 403 HERE, WHERE ITS SIBLINGS ANSWER AN EMPTY LAYER.
 * The sibling backdrop layers have no subject — an empty collection means "your
 * workspace has none of these", which is true for a user with no workspace.
 * This route has a subject named in the URL, so an empty collection would be a
 * claim about THAT cycle's portfolio. Refusing is the honest answer.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { MAP_FEATURE_LAYER_LIMIT } from "@/lib/cartographic/layer-disclosure";
/**
 * The projection and the payload shape live in a lib module, not here: Next's
 * generated route types reject a non-handler VALUE export from `route.ts`, and
 * the projection has to be a value so a test can assert on the `.select()`
 * string. See the module's own header.
 */
import {
  buildRtpCycleProjectFeatureCollection,
  RTP_CYCLE_PROJECT_MAP_COLUMNS,
  type RtpCycleProjectLinkRow,
} from "@/lib/cartographic/rtp-cycle-project-layer";

/** The migration that added `horizon_band_id`, `estimated_cost` and `cost_basis_year`. */
const FINANCIAL_ELEMENT_MIGRATION = "20260805000003_rtp_financial_element.sql";

const querySchema = z.object({ rtpCycleId: z.string().uuid() });

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-features.rtp-cycle-projects", request);
  const startedAt = Date.now();

  try {
    const query = querySchema.safeParse({
      rtpCycleId: request.nextUrl.searchParams.get("rtpCycleId") ?? undefined,
    });

    if (!query.success) {
      audit.warn("query_validation_failed", { issues: query.error.issues });
      return NextResponse.json(
        {
          error: "Invalid RTP cycle id",
          hint: "Pass ?rtpCycleId=<uuid> naming the plan cycle whose project list should be drawn.",
        },
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

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

    if (!membership || !canAccessWorkspaceAction("plans.read", membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // The cycle is proven to belong to the caller's OWN workspace before any
    // project is read. The filter is what makes another workspace's cycle
    // indistinguishable from one that does not exist.
    const cycleResult = await supabase
      .from("rtp_cycles")
      .select("id, workspace_id")
      .eq("id", query.data.rtpCycleId)
      .eq("workspace_id", membership.workspace_id)
      .maybeSingle();

    // A failed read and an empty read are both `null` here. Answering "RTP cycle
    // not found" to a query that never ran would send a planner looking for a
    // cycle sitting right in front of them.
    const cycleFailure = classifyRouteReadFailure("the RTP cycle", cycleResult);
    if (cycleFailure) {
      audit.error("cycle_lookup_failed", {
        rtpCycleId: query.data.rtpCycleId,
        message: cycleFailure.message,
      });
      return NextResponse.json(cycleFailure.body, { status: cycleFailure.status });
    }

    if (!cycleResult.data) {
      return NextResponse.json({ error: "RTP cycle not found" }, { status: 404 });
    }

    // Scoped by BOTH the cycle and the workspace. The workspace filter is
    // redundant against RLS and kept anyway: RLS grants every workspace the
    // caller belongs to, so it is not scoping, and a link row whose
    // workspace_id ever diverged from its cycle's would otherwise be drawn on
    // another agency's map.
    const { data, error, count } = await supabase
      .from("project_rtp_cycle_links")
      .select(RTP_CYCLE_PROJECT_MAP_COLUMNS, { count: "exact" })
      .eq("rtp_cycle_id", query.data.rtpCycleId)
      .eq("workspace_id", membership.workspace_id)
      .order("created_at", { ascending: false })
      // Stable tiebreak, so a truncated payload is the same subset between
      // loads rather than an arbitrary slice that reshuffles.
      .order("id", { ascending: true })
      .limit(MAP_FEATURE_LAYER_LIMIT);

    if (error) {
      // A deployment carrying this code but not 20260805000003 asks for three
      // columns that do not exist yet. That is a setup step, not a server
      // fault, and 503-with-the-migration-named is the difference between an
      // operator running one command and an operator reading "failed to load"
      // with nowhere to go. `classifyRouteReadFailure` always answers when an
      // error is present, so this branch cannot fall through to a 200.
      const failure = classifyRouteReadFailure(
        "the projects in this RTP cycle",
        { error },
        {
          pendingError: "RTP financial schema is not available yet",
          pendingHint: `Apply migration ${FINANCIAL_ELEMENT_MIGRATION}, then try again.`,
        }
      ) ?? {
        status: 500 as const,
        body: { error: "Failed to load the projects in this RTP cycle" },
      };
      audit.error("rtp_cycle_projects_query_failed", {
        rtpCycleId: query.data.rtpCycleId,
        workspaceId: membership.workspace_id,
        message: error.message,
        code: (error as { code?: string | null }).code ?? null,
      });
      return NextResponse.json(failure.body, { status: failure.status });
    }

    // `as unknown as` because an embedded relation in the projection makes
    // supabase-js infer `GenericStringError[]` — the untyped-client convention
    // this repo keeps deliberately (see the CLAUDE.md note on generated types).
    const rows = (data ?? []) as unknown as RtpCycleProjectLinkRow[];

    // Assembly lives in the layer lib because the public plan share page
    // builds the SAME collection server-side; a route-private copy would let
    // the two maps drift about the same plan.
    const payload = buildRtpCycleProjectFeatureCollection(rows, count);

    audit.info("rtp_cycle_projects_loaded", {
      rtpCycleId: query.data.rtpCycleId,
      workspaceId: membership.workspace_id,
      count: payload.features.length,
      withoutGeometry: payload.withoutGeometry,
      withoutReadableProject: payload.withoutReadableProject,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    audit.error("rtp_cycle_projects_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Unexpected error while loading the projects in this RTP cycle" },
      { status: 500 }
    );
  }
}
