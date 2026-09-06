import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  checkWorkspaceMembership,
  type WorkspaceMembershipResult,
} from "@/lib/workspaces/membership";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { studyAreaBboxesMatch } from "@/lib/models/study-area";

// Paging a county-scale crash extract exceeds the default budget.
export const runtime = "nodejs";
export const maxDuration = 60;

/** Hard ceiling regardless of what the caller asks for. */
const MAX_RECORDS_CEILING = 50_000;
type ProjectStudyAreaBounds = {
  place_min_lon: number | null;
  place_min_lat: number | null;
  place_max_lon: number | null;
  place_max_lat: number | null;
};

function bboxMatchesProjectStudyArea(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  project: ProjectStudyAreaBounds,
): boolean {
  const expected = [
    project.place_min_lon,
    project.place_min_lat,
    project.place_max_lon,
    project.place_max_lat,
  ];
  if (!expected.every((value): value is number => typeof value === "number" && Number.isFinite(value))) {
    return false;
  }
  return studyAreaBboxesMatch(bbox, {
    minLon: expected[0],
    minLat: expected[1],
    maxLon: expected[2],
    maxLat: expected[3],
  });
}

const ingestSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  bbox: z.object({
    minLon: z.number().min(-180).max(180),
    minLat: z.number().min(-90).max(90),
    maxLon: z.number().min(-180).max(180),
    maxLat: z.number().min(-90).max(90),
  }),
  // Jurisdiction-neutral bounds. The transport layer must not encode one
  // source's calendar or one state's county count — the ADAPTER owns those
  // limits and clamps against its own live manifest (CCRS, for example, starts
  // in 2016 and numbers 58 California counties). Baking either here would mean
  // editing this route to add a state or a data source.
  years: z.array(z.number().int().min(1900).max(2100)).min(1).max(20),
  /** Source-specific subdivision code, validated by the adapter that uses it. */
  countyCode: z.number().int().positive().optional(),
  maxRecords: z.number().int().min(1).max(MAX_RECORDS_CEILING).optional(),
});

function membershipErrorResponse(result: Extract<WorkspaceMembershipResult, { ok: false }>) {
  if (result.kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Safety schema is not available yet",
        hint: "Apply the latest Supabase migrations before ingesting crash data.",
      },
      { status: 503 }
    );
  }
  if (result.kind === "not_member") {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("safety.crashes.ingest", request);
  const startedAt = Date.now();

  try {
    // Bounded read: every mutating route caps its body so an oversized payload
    // is a 413 rather than a memory spike. Enforced repo-wide by
    // src/test/body-limit-route-inventory.test.ts.
    const bodyResult = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }
    if (bodyResult.parseError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = ingestSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid ingest parameters" }, { status: 400 });
    }

    const { bbox } = parsed.data;
    if (bbox.minLon >= bbox.maxLon || bbox.minLat >= bbox.maxLat) {
      return NextResponse.json({ error: "Invalid study-area bounding box" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, parsed.data.workspaceId);
    if (!membership.ok) {
      return membershipErrorResponse(membership);
    }
    /*
     * A VIEWER IS NOT REFUSED AT THE DOOR, BECAUSE THIS DOOR HAS TWO ROOMS.
     *
     * This route is the only way into the crash lane, and the lane has two
     * outcomes. Where a STORABLE source covers the study area it writes
     * `safety_crash_ingests` and `safety_crashes` — a write, and one a viewer
     * must not make. Where none does, it falls through to the READ-ONLY path
     * (FARS today), which returns live points, writes nothing, and is the only
     * crash data available anywhere outside California.
     *
     * Refusing 403 on the role alone meant a viewer in Ohio saw no crashes at
     * all, from a request that would have stored nothing — restriction standing
     * in for a permission the request never needed. Disclose, never restrict.
     *
     * The capability is PASSED DOWN rather than predicted here. A gate built on
     * this route guessing which branch the lane would take would be a
     * permission decision resting on a comment claiming a branch is
     * unreachable, and `ingestCrashesForStudyArea` has a no-coverage path that
     * writes an acquisition row precisely where such a guess says it will not.
     * With `mayStore: false` the lane refuses at each write instead.
     */
    const mayStore = !isReadOnlyWorkspaceRole(membership.role);

    // A project link must name a project of THIS workspace — same posture as
    // the Knowledge Base upload route. RLS would hide a foreign project anyway;
    // the explicit check turns that into an honest 404 instead of a silent
    // null link.
    if (parsed.data.projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id, place_min_lon, place_min_lat, place_max_lon, place_max_lat")
        .eq("id", parsed.data.projectId)
        .eq("workspace_id", parsed.data.workspaceId)
        .maybeSingle();
      if (projectError) {
        return NextResponse.json({ error: "Failed to verify linked project" }, { status: 500 });
      }
      if (!project) {
        return NextResponse.json({ error: "Linked project not found" }, { status: 404 });
      }
      if (!bboxMatchesProjectStudyArea(bbox, project as ProjectStudyAreaBounds)) {
        return NextResponse.json(
          {
            error:
              "This crash study area does not match the linked project's stored study area. Open Safety from that project, or clear the project context before retrieving crashes.",
          },
          { status: 409 },
        );
      }
    }

    audit.info("safety_crash_ingest_started", {
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      years: parsed.data.years,
      countyCode: parsed.data.countyCode ?? null,
    });

    const result = await ingestCrashesForStudyArea({
      service: createServiceRoleClient(),
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId ?? null,
      bbox,
      years: parsed.data.years,
      countyCode: parsed.data.countyCode,
      maxRecords: parsed.data.maxRecords,
      requestedBy: user.id,
      mayStore,
      signal: request.signal,
    });

    audit.info("safety_crash_ingest_finished", {
      workspaceId: parsed.data.workspaceId,
      ingestId: result.ingestId,
      status: result.status,
      crashCount: result.crashCount,
      geocodedCount: result.geocodedCount,
      durationMs: Date.now() - startedAt,
    });

    // `no_coverage` and `failed` are honest, expected outcomes — the caller
    // renders them, so they are 200s carrying a status, not HTTP errors.
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    audit.error("safety_crash_ingest_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while ingesting crash data" },
      { status: 500 }
    );
  }
}
