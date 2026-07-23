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

// Paging a county-scale crash extract exceeds the default budget.
export const runtime = "nodejs";
export const maxDuration = 60;

/** Hard ceiling regardless of what the caller asks for. */
const MAX_RECORDS_CEILING = 50_000;

const ingestSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  bbox: z.object({
    minLon: z.number().min(-180).max(180),
    minLat: z.number().min(-90).max(90),
    maxLon: z.number().min(-180).max(180),
    maxLat: z.number().min(-90).max(90),
  }),
  // CCRS begins in 2016; the adapter clamps further against the live manifest.
  years: z.array(z.number().int().min(2016).max(2100)).min(1).max(20),
  countyCode: z.number().int().min(1).max(58).optional(),
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
