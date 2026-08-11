/**
 * REGISTRY DISPOSITION — REFUSED as an assistant action, 2026-08-11. Neither
 * write on this route may be registered as a `propose_*` action without being
 * re-argued from scratch; the executable form of this refusal is
 * `src/test/refused-aerial-actions-stay-refused.test.ts`.
 *
 * The parameter save is the campaign-accessibility-contact precedent wearing a
 * flight suit: altitude, speed and the two overlaps are consequential,
 * safety-relevant numbers a crew physically flies, and a model would author
 * them from OUTSIDE the system — a plausible 120 m at 12 m/s is
 * indistinguishable from a correct 80 m at 6 m/s on an approval sheet, and the
 * only control is the approver noticing. Every registered action's
 * consequential payload is an id the agent verified against a workspace row or
 * an enum; a flight parameter is neither.
 *
 * The snapshot save is worse, not safer, for looking derived: saving
 * `generatedPlan` is what ARMS the export lane — it converts parameters into a
 * stamped, non-stale snapshot that `/flight-plan/export` will serve as a
 * flyable .kmz/CSV a pilot loads into a real aircraft. An agent that can save
 * the snapshot holds both halves of author-and-arm. A future session must
 * re-argue this refusal, not assume it — and must record why the argument
 * changed, in the refusal test, if it ever does.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import {
  getCamera,
  hashFlightPlanParams,
  listCameras,
  resolveVerticalProfile,
  type FlightPlanHashInput,
} from "@/lib/aerial/camera-registry";

const paramsSchema = z.object({
  missionId: z.string().uuid(),
});

/**
 * Every column the table has, by name. The clients are untyped, so this string
 * is the only place a dropped column would surface — the route test asserts on
 * it directly and the migration test proves each name exists in the schema.
 */
const FLIGHT_PLAN_COLUMNS =
  "id, workspace_id, mission_id, camera_key, target_gsd_cm_per_px, altitude_agl_m, " +
  "front_overlap_pct, side_overlap_pct, speed_m_s, gimbal_pitch_deg, cross_grid, " +
  "boundary_margin_m, corridor_width_m, crew_pilot_name, rth_altitude_m, notes, " +
  "generated_plan, generated_at, generated_with, updated_by, created_at, updated_at";

/**
 * PUT replaces the plan's parameters wholesale — omitting an optional field
 * clears it. `.strict()` is load-bearing, not style: a payload carrying fields
 * beyond the plan's own (a decoy `status`, a `workspaceId` override) is
 * refused outright rather than silently stripped, so what a planner saved is
 * exactly what they sent and nothing more.
 *
 * `generatedPlan` is the grid snapshot: present-as-object saves it (with a
 * server-computed timestamp and parameter fingerprint), present-as-null clears
 * it, absent leaves the stored snapshot untouched — which is what makes a
 * later parameter edit DETECTABLY stale instead of quietly wrong.
 */
const putFlightPlanSchema = z
  .object({
    cameraKey: z.string().trim().min(1).max(120),
    targetGsdCmPerPx: z.number().positive().nullable().optional(),
    altitudeAglM: z.number().positive().nullable().optional(),
    // 40–95: the photogrammetric bounds, matching the table's CHECKs.
    frontOverlapPct: z.number().min(40).max(95),
    sideOverlapPct: z.number().min(40).max(95),
    speedMS: z.number().positive().nullable().optional(),
    // -90 = nadir, 0 = horizon; matching the table's CHECK.
    gimbalPitchDeg: z.number().min(-90).max(0).nullable().optional(),
    crossGrid: z.boolean().default(false),
    boundaryMarginM: z.number().min(0).nullable().optional(),
    corridorWidthM: z.number().positive().nullable().optional(),
    crewPilotName: z.string().trim().min(1).max(200).nullable().optional(),
    rthAltitudeM: z.number().positive().nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    generatedPlan: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict()
  .refine((data) => (data.targetGsdCmPerPx ?? null) !== null || (data.altitudeAglM ?? null) !== null, {
    message:
      "State the plan's vertical intent: a target ground resolution (cm/px), a flight altitude (m above ground), or both — given the camera, either one derives the other.",
  });

type RouteContext = { params: Promise<{ missionId: string }> };

type FlightPlanRow = {
  camera_key: string;
  target_gsd_cm_per_px: number | string | null;
  altitude_agl_m: number | string | null;
  front_overlap_pct: number | string;
  side_overlap_pct: number | string;
  speed_m_s: number | string | null;
  gimbal_pitch_deg: number | string | null;
  cross_grid: boolean;
  boundary_margin_m: number | string | null;
  corridor_width_m: number | string | null;
  generated_with: string | null;
};

/** PostgREST returns NUMERIC as a JSON string; the fingerprint needs numbers. */
function asNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hashInputFromRow(row: FlightPlanRow, aoiGeojson: unknown): FlightPlanHashInput {
  return {
    aoiGeojson: aoiGeojson ?? null,
    cameraKey: row.camera_key,
    targetGsdCmPerPx: asNumber(row.target_gsd_cm_per_px),
    altitudeAglM: asNumber(row.altitude_agl_m),
    frontOverlapPct: asNumber(row.front_overlap_pct) ?? 0,
    sideOverlapPct: asNumber(row.side_overlap_pct) ?? 0,
    speedMS: asNumber(row.speed_m_s),
    gimbalPitchDeg: asNumber(row.gimbal_pitch_deg),
    crossGrid: row.cross_grid,
    boundaryMarginM: asNumber(row.boundary_margin_m),
    corridorWidthM: asNumber(row.corridor_width_m),
  };
}

/**
 * The derived half of the vertical profile, disclosed rather than assumed: the
 * UI shows which number the planner authored and which one the registry
 * derived. An unknown camera key (a registry entry that has since been
 * renamed) is reported as exactly that, never silently defaulted.
 */
function verticalDisclosure(row: FlightPlanRow) {
  const camera = getCamera(row.camera_key);
  if (!camera) {
    return { cameraKnown: false as const, profile: null };
  }
  return {
    cameraKnown: true as const,
    profile: resolveVerticalProfile(camera, {
      targetGsdCmPerPx: asNumber(row.target_gsd_cm_per_px),
      altitudeAglM: asNumber(row.altitude_agl_m),
    }),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-flight-plan.read", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: mission, error: missionError } = await supabase
      .from("aerial_missions")
      .select("id, workspace_id, aoi_geojson")
      .eq("id", parsedParams.data.missionId)
      .maybeSingle();

    if (missionError) {
      audit.error("aerial_mission_load_failed", {
        missionId: parsedParams.data.missionId,
        message: missionError.message,
      });
      return NextResponse.json({ error: "Failed to load mission" }, { status: 500 });
    }
    if (!mission) {
      return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", mission.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_check_failed", {
        workspaceId: mission.workspace_id,
        message: membershipError.message,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    if (!membership) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: plan, error: planError } = await supabase
      .from("aerial_flight_plans")
      .select(FLIGHT_PLAN_COLUMNS)
      .eq("mission_id", mission.id)
      .maybeSingle();

    if (planError) {
      audit.error("aerial_flight_plan_load_failed", {
        missionId: mission.id,
        message: planError.message,
      });
      return NextResponse.json({ error: "Failed to load flight plan" }, { status: 500 });
    }

    if (!plan) {
      // Honest null: no plan has been authored for this mission. Not an error,
      // and not an empty object a client could mistake for a plan.
      audit.info("aerial_flight_plan_read", {
        missionId: mission.id,
        userId: user.id,
        found: false,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ flightPlan: null });
    }

    const row = plan as unknown as FlightPlanRow;
    const currentFingerprint = hashFlightPlanParams(hashInputFromRow(row, mission.aoi_geojson));
    const generatedPlanStale = row.generated_with !== null && row.generated_with !== currentFingerprint;

    audit.info("aerial_flight_plan_read", {
      missionId: mission.id,
      userId: user.id,
      found: true,
      generatedPlanStale,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      flightPlan: plan,
      generatedPlanStale,
      vertical: verticalDisclosure(row),
    });
  } catch (error) {
    audit.error("aerial_flight_plan_read_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while loading flight plan" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-flight-plan.save", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    // networkGeoJson (2 MiB): the payload may carry the generated grid
    // snapshot, which is geometry-sized, not form-sized.
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.networkGeoJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = putFlightPlanSchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid flight plan payload" }, { status: 400 });
    }

    const camera = getCamera(parsed.data.cameraKey);
    if (!camera) {
      audit.warn("unknown_camera_key", { cameraKey: parsed.data.cameraKey });
      return NextResponse.json(
        {
          error: `Unknown camera key "${parsed.data.cameraKey}". Choose one of the cameras this deployment knows.`,
          knownCameraKeys: listCameras().map((entry) => entry.key),
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

    const { data: mission, error: missionError } = await supabase
      .from("aerial_missions")
      .select("id, workspace_id, aoi_geojson")
      .eq("id", parsedParams.data.missionId)
      .maybeSingle();

    if (missionError) {
      audit.error("aerial_mission_load_failed", {
        missionId: parsedParams.data.missionId,
        message: missionError.message,
      });
      return NextResponse.json({ error: "Failed to load mission" }, { status: 500 });
    }
    if (!mission) {
      return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", mission.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_check_failed", {
        workspaceId: mission.workspace_id,
        message: membershipError.message,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    if (!membership) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }
    if (isReadOnlyWorkspaceRole((membership as { role?: string }).role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
    }

    const paramsFingerprint = hashFlightPlanParams({
      aoiGeojson: mission.aoi_geojson ?? null,
      cameraKey: camera.key,
      targetGsdCmPerPx: parsed.data.targetGsdCmPerPx ?? null,
      altitudeAglM: parsed.data.altitudeAglM ?? null,
      frontOverlapPct: parsed.data.frontOverlapPct,
      sideOverlapPct: parsed.data.sideOverlapPct,
      speedMS: parsed.data.speedMS ?? null,
      gimbalPitchDeg: parsed.data.gimbalPitchDeg ?? null,
      crossGrid: parsed.data.crossGrid,
      boundaryMarginM: parsed.data.boundaryMarginM ?? null,
      corridorWidthM: parsed.data.corridorWidthM ?? null,
    });

    const row: Record<string, unknown> = {
      mission_id: mission.id,
      workspace_id: mission.workspace_id,
      camera_key: camera.key,
      target_gsd_cm_per_px: parsed.data.targetGsdCmPerPx ?? null,
      altitude_agl_m: parsed.data.altitudeAglM ?? null,
      front_overlap_pct: parsed.data.frontOverlapPct,
      side_overlap_pct: parsed.data.sideOverlapPct,
      speed_m_s: parsed.data.speedMS ?? null,
      gimbal_pitch_deg: parsed.data.gimbalPitchDeg ?? null,
      cross_grid: parsed.data.crossGrid,
      boundary_margin_m: parsed.data.boundaryMarginM ?? null,
      corridor_width_m: parsed.data.corridorWidthM ?? null,
      crew_pilot_name: parsed.data.crewPilotName ?? null,
      rth_altitude_m: parsed.data.rthAltitudeM ?? null,
      notes: parsed.data.notes ? parsed.data.notes : null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    if ("generatedPlan" in parsed.data) {
      if (parsed.data.generatedPlan === null) {
        row.generated_plan = null;
        row.generated_at = null;
        row.generated_with = null;
      } else {
        row.generated_plan = parsed.data.generatedPlan;
        row.generated_at = new Date().toISOString();
        // Server-computed, never client-supplied: the fingerprint must describe
        // the parameters being SAVED, or staleness detection means nothing.
        row.generated_with = paramsFingerprint;
      }
    }

    const { data: saved, error: saveError } = await supabase
      .from("aerial_flight_plans")
      .upsert(row, { onConflict: "mission_id" })
      .select(FLIGHT_PLAN_COLUMNS)
      .single();

    if (saveError || !saved) {
      audit.error("aerial_flight_plan_save_failed", {
        missionId: mission.id,
        userId: user.id,
        message: saveError?.message ?? "unknown",
        code: saveError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to save flight plan" }, { status: 500 });
    }

    const savedRow = saved as unknown as FlightPlanRow;
    const generatedPlanStale =
      savedRow.generated_with !== null && savedRow.generated_with !== paramsFingerprint;

    audit.info("aerial_flight_plan_saved", {
      missionId: mission.id,
      workspaceId: mission.workspace_id,
      userId: user.id,
      cameraKey: camera.key,
      snapshotIncluded: "generatedPlan" in parsed.data && parsed.data.generatedPlan !== null,
      generatedPlanStale,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      flightPlan: saved,
      generatedPlanStale,
      vertical: verticalDisclosure(savedRow),
    });
  } catch (error) {
    audit.error("aerial_flight_plan_save_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while saving flight plan" }, { status: 500 });
  }
}
