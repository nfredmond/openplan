import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  checkWorkspaceMembership,
  type WorkspaceMembershipResult,
} from "@/lib/workspaces/membership";
import { CRASH_SEVERITIES } from "@/lib/safety/sources/types";

/**
 * Crash query for the Safety map and list.
 *
 * Deliberately NOT a `/api/map-features/*` sibling. Those seven routes take no
 * query parameters and hard-cap at `.limit(500)` under PostgREST
 * `max_rows = 1000`, which is fine for the hundreds of rows they serve — but a
 * county crash extract is 10^4-10^5 rows, so 500 arbitrary crashes would be a
 * meaningless map. This route takes an explicit bbox plus severity/mode/year
 * filters, and returns `returnedCount` alongside `matchedCount` so the UI can
 * say "showing N of M in view" instead of silently truncating.
 */

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  minLon: z.coerce.number().min(-180).max(180),
  minLat: z.coerce.number().min(-90).max(90),
  maxLon: z.coerce.number().min(-180).max(180),
  maxLat: z.coerce.number().min(-90).max(90),
  severity: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .refine(
      (values) => !values || values.every((v) => (CRASH_SEVERITIES as readonly string[]).includes(v)),
      { message: "Unknown severity" }
    ),
  mode: z.enum(["all", "pedestrian", "bicyclist", "vru"]).optional(),
  yearFrom: z.coerce.number().int().min(1900).max(2100).optional(),
  yearTo: z.coerce.number().int().min(1900).max(2100).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

function membershipErrorResponse(result: Extract<WorkspaceMembershipResult, { ok: false }>) {
  if (result.kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Safety schema is not available yet",
        hint: "Apply the latest Supabase migrations before querying crash data.",
      },
      { status: 503 }
    );
  }
  if (result.kind === "not_member") {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("safety.crashes.list", request);
  const startedAt = Date.now();

  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid crash query parameters" }, { status: 400 });
    }

    const query = parsed.data;
    if (query.minLon >= query.maxLon || query.minLat >= query.maxLat) {
      return NextResponse.json({ error: "Invalid bounding box" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, query.workspaceId);
    if (!membership.ok) {
      return membershipErrorResponse(membership);
    }

    const limit = query.limit ?? DEFAULT_LIMIT;

    // RLS scopes reads to workspace members; the explicit workspace filter keeps
    // the query planner honest and the intent obvious. The two queries are built
    // separately so each `select()` stays a string literal — supabase-js infers
    // row types from it, and a conditional expression defeats that.
    type CrashFilterable = {
      eq: (column: string, value: unknown) => CrashFilterable;
      gte: (column: string, value: unknown) => CrashFilterable;
      lte: (column: string, value: unknown) => CrashFilterable;
      in: (column: string, values: readonly unknown[]) => CrashFilterable;
      or: (filter: string) => CrashFilterable;
    };

    const applyFilters = <T>(builder: T): T => {
      let q = builder as unknown as CrashFilterable;
      q = q
        .eq("workspace_id", query.workspaceId)
        .gte("longitude", query.minLon)
        .lte("longitude", query.maxLon)
        .gte("latitude", query.minLat)
        .lte("latitude", query.maxLat);

      if (query.severity?.length) q = q.in("severity", query.severity);
      if (query.yearFrom !== undefined) q = q.gte("collision_year", query.yearFrom);
      if (query.yearTo !== undefined) q = q.lte("collision_year", query.yearTo);
      if (query.mode === "pedestrian") q = q.eq("pedestrian_involved", true);
      if (query.mode === "bicyclist") q = q.eq("bicyclist_involved", true);
      if (query.mode === "vru") q = q.or("pedestrian_involved.eq.true,bicyclist_involved.eq.true");

      return q as unknown as T;
    };

    const [countResult, rowsResult] = await Promise.all([
      applyFilters(supabase.from("safety_crashes").select("id", { count: "exact", head: true })),
      applyFilters(
        supabase
          .from("safety_crashes")
          .select(
            "id,external_id,collision_date,collision_year,severity,killed_count,injured_count,pedestrian_involved,bicyclist_involved,latitude,longitude,source_id"
          )
      ).order("collision_date", { ascending: false, nullsFirst: false }).limit(limit),
    ]);

    if (rowsResult.error) {
      audit.warn("safety_crash_list_failed", {
        workspaceId: query.workspaceId,
        error: rowsResult.error.message,
      });
      return NextResponse.json({ error: "Failed to load crash data" }, { status: 500 });
    }

    const rows = (rowsResult.data ?? []) as Array<Record<string, unknown>>;
    const matchedCount = countResult.error ? rows.length : countResult.count ?? rows.length;

    audit.info("safety_crash_list_loaded", {
      workspaceId: query.workspaceId,
      returnedCount: rows.length,
      matchedCount,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        // GeoJSON so the map can consume it directly.
        type: "FeatureCollection",
        features: rows.map((row) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [Number(row.longitude), Number(row.latitude)],
          },
          properties: {
            kind: "safety_crash",
            id: row.id,
            externalId: row.external_id,
            sourceId: row.source_id,
            collisionDate: row.collision_date,
            collisionYear: row.collision_year,
            severity: row.severity,
            killedCount: row.killed_count,
            injuredCount: row.injured_count,
            pedestrianInvolved: row.pedestrian_involved,
            bicyclistInvolved: row.bicyclist_involved,
          },
        })),
        // Load-bearing for honest UI copy: "showing N of M crashes in view".
        returnedCount: rows.length,
        matchedCount,
        truncated: rows.length < matchedCount,
        limit,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("safety_crash_list_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading crash data" }, { status: 500 });
  }
}
