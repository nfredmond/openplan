/**
 * Read and set a workspace's HOME GEOGRAPHY — the place of record that
 * geography-aware surfaces read instead of inventing a constant.
 * See src/lib/workspaces/home-geography.ts for the shape and its rules.
 *
 * The write takes a PLACE REFERENCE (kind + GEOID), not a bounding box: the
 * server re-resolves the boundary through the app's existing any-place resolver
 * so the stored extent and label always come from the source of record. A
 * client-supplied bbox would be an unverifiable geography with a trusted-looking
 * provenance — the failure this codebase refuses.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { normalizeWorkspaceRole } from "@/lib/auth/role-matrix";
import { placeKindSchema } from "@/lib/api/place-geographies";
import { resolvePlaceBoundary } from "@/lib/geographies/place-resolver";
import {
  checkWorkspaceMembership,
  looksLikePendingSchema,
  type WorkspaceMembershipResult,
} from "@/lib/workspaces/membership";
import {
  HOME_GEOGRAPHY_COLUMNS,
  homeGeographyFromPlaceBoundary,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";

// Resolving a boundary calls out to TIGERweb.
export const runtime = "nodejs";

/**
 * Stating where the agency works is workspace configuration, not day-to-day
 * work: it re-frames maps and can re-bind the jurisdiction rules everyone in the
 * workspace then sees. The repo's role matrix scopes configuration actions
 * (billing.checkout) to owner/admin, and this follows that convention.
 */
const HOME_GEOGRAPHY_WRITE_ROLES = new Set(["owner", "admin"]);

const setHomeGeographySchema = z.object({
  workspaceId: z.string().uuid(),
  /** A place the existing picker resolved: which layer, and its id in that layer. */
  kind: placeKindSchema,
  geoid: z
    .string()
    .regex(/^\d{5,7}$/, "GEOID must be 5-7 digits"),
  /** Optional operator-facing name; falls back to the resolver's own label. */
  label: z.string().trim().min(1).max(200).optional(),
});

function membershipErrorResponse(result: Extract<WorkspaceMembershipResult, { ok: false }>) {
  if (result.kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Workspace schema is not available yet",
        hint: "Apply the latest Supabase migrations before setting a home geography.",
      },
      { status: 503 }
    );
  }
  if (result.kind === "not_member") {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
}

/**
 * Current home geography for a workspace the caller belongs to.
 *
 * `homeGeography: null` is a first-class answer, not an error: it means the
 * workspace has not stated where it works, and the caller must fall back to
 * something neutral rather than to a place.
 */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.home_geography.read", request);
  const startedAt = Date.now();

  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
    if (!z.string().uuid().safeParse(workspaceId).success) {
      return NextResponse.json({ error: "A valid workspaceId is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, workspaceId);
    if (!membership.ok) {
      return membershipErrorResponse(membership);
    }

    // Read through the caller's own client: `workspaces` already grants members
    // SELECT, so RLS is the guard rather than a second privileged path.
    const { data, error } = await supabase
      .from("workspaces")
      .select(HOME_GEOGRAPHY_COLUMNS)
      .eq("id", workspaceId)
      .maybeSingle();

    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json(
          {
            error: "Workspace home geography is not available yet",
            hint: "Apply the latest Supabase migrations.",
          },
          { status: 503 }
        );
      }
      audit.error("home_geography_read_failed", { workspaceId, error });
      return NextResponse.json({ error: "Failed to load home geography" }, { status: 500 });
    }

    return NextResponse.json(
      { workspaceId, homeGeography: parseWorkspaceHomeGeography(data) },
      { status: 200 }
    );
  } catch (error) {
    audit.error("home_geography_read_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading the home geography" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.home_geography.set", request);
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

    const parsed = setHomeGeographySchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid home geography parameters" }, { status: 400 });
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

    const role = normalizeWorkspaceRole(membership.role);
    if (!role || !HOME_GEOGRAPHY_WRITE_ROLES.has(role)) {
      return NextResponse.json(
        { error: "Only a workspace owner or admin can set the home geography" },
        { status: 403 }
      );
    }

    const boundary = await resolvePlaceBoundary(parsed.data.kind, parsed.data.geoid);
    if (!boundary) {
      // Fail closed. Recording the id without a verified boundary would leave a
      // geography that renders as an empty or wrong extent everywhere it is read.
      audit.warn("home_geography_place_unresolved", {
        workspaceId: parsed.data.workspaceId,
        kind: parsed.data.kind,
        geoid: parsed.data.geoid,
      });
      return NextResponse.json(
        {
          error: "No boundary found for that place",
          hint: "Pick the place again from search so its official boundary can be resolved.",
        },
        { status: 404 }
      );
    }

    const row = homeGeographyFromPlaceBoundary(boundary, { label: parsed.data.label ?? null });

    const { data, error } = await createServiceRoleClient()
      .from("workspaces")
      .update(row)
      .eq("id", parsed.data.workspaceId)
      .select(HOME_GEOGRAPHY_COLUMNS)
      .maybeSingle();

    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json(
          {
            error: "Workspace home geography is not available yet",
            hint: "Apply the latest Supabase migrations before setting a home geography.",
          },
          { status: 503 }
        );
      }
      audit.error("home_geography_write_failed", {
        workspaceId: parsed.data.workspaceId,
        error,
      });
      return NextResponse.json({ error: "Failed to set the home geography" }, { status: 500 });
    }

    audit.info("home_geography_set", {
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      source: row.home_geography_source,
      kind: row.home_geography_kind,
      ref: row.home_geography_ref,
      countryCode: row.home_country_code,
      subdivisionCode: row.home_subdivision_code,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        workspaceId: parsed.data.workspaceId,
        homeGeography: parseWorkspaceHomeGeography(data ?? row),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("home_geography_set_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while setting the home geography" },
      { status: 500 }
    );
  }
}
