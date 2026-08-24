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

import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { ingestCensusTractsForCounty } from "@/lib/data-sources/census-tract-ingest";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { placeKindSchema } from "@/lib/api/place-geographies";
import { resolvePlaceBoundary } from "@/lib/geographies/place-resolver";
import {
  readWorkspaceStageGateTemplateSelection,
  resolveStageGateTemplateForWorkspace,
  resolveStageGateTemplateBinding,
  type StageGateTemplateSelection,
} from "@/lib/stage-gates/template-loader";
import {
  checkWorkspaceMembership,
  looksLikePendingSchema,
  type WorkspaceMembershipResult,
} from "@/lib/workspaces/membership";
import {
  clearedHomeGeographyRow,
  HOME_GEOGRAPHY_COLUMNS,
  homeGeographyFromPlaceBoundary,
  parseWorkspaceHomeGeography,
  tigerwebCountyFipsFromHomeGeography,
} from "@/lib/workspaces/home-geography";

// Resolving a boundary calls out to TIGERweb.
export const runtime = "nodejs";
// The `after()` block below runs the same county tract ingest that
// /api/geographies/census-tracts/ingest documents as needing more than the
// default budget. Without this the background load was cut off part way through
// any metropolitan county, leaving a silently partial layer.
export const maxDuration = 60;

/**
 * Stating where the agency works is workspace configuration, not day-to-day
 * work: it re-frames maps and can re-bind the jurisdiction rules everyone in the
 * workspace then sees.
 *
 * This now goes through the role matrix's `workspace.configure` action rather
 * than a local role Set. The Set was written when the only configuration-shaped
 * action in the matrix was `billing.checkout` — a Stripe action that has since
 * been deleted along with the rest of the paid-tier subsystem. Configuration is
 * a first-class action now, so scoping reads from one table instead of being
 * re-decided per route.
 */
const HOME_GEOGRAPHY_WRITE_ACTION = "workspace.configure";
const STAGE_GATE_CONFIGURATION_COLUMNS =
  "stage_gate_template_id, stage_gate_template_version, stage_gate_template_selection";

const clearHomeGeographySchema = z.object({
  workspaceId: z.string().uuid(),
});

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

function automaticStageGateUpdate(
  currentSelection: StageGateTemplateSelection | null,
  workspaceWithGeography: unknown
):
  | { kind: "preserve" }
  | {
      kind: "update";
      row: Record<string, unknown>;
    }
  | { kind: "ambiguous" }
  | { kind: "unresolved" } {
  if (currentSelection === null || currentSelection === "explicitly_requested") {
    return { kind: "preserve" };
  }

  const resolution = resolveStageGateTemplateForWorkspace(workspaceWithGeography);
  if (resolution.kind !== "resolved") return { kind: "unresolved" };
  if (resolution.binding.interimDefaultReason === "ambiguous_jurisdiction_templates") {
    return { kind: "ambiguous" };
  }

  const selection = resolution.binding.templateSelection;
  if (selection === "explicitly_requested") return { kind: "unresolved" };
  return {
    kind: "update",
    row: {
      stage_gate_template_id: resolution.binding.templateId,
      stage_gate_template_version: resolution.binding.templateVersion,
      stage_gate_template_selection: selection,
      stage_gate_bound_at: new Date().toISOString(),
    },
  };
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

    if (!canAccessWorkspaceAction(HOME_GEOGRAPHY_WRITE_ACTION, membership.role)) {
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

    const currentRead = await supabase
      .from("workspaces")
      .select(STAGE_GATE_CONFIGURATION_COLUMNS)
      .eq("id", parsed.data.workspaceId)
      .maybeSingle();
    if (currentRead.error) {
      if (looksLikePendingSchema(currentRead.error.message)) {
        return NextResponse.json(
          {
            error: "Workspace legal configuration is not available yet",
            hint: "Apply the latest Supabase migrations before setting a home geography.",
          },
          { status: 503 }
        );
      }
      audit.error("home_geography_binding_read_failed", {
        workspaceId: parsed.data.workspaceId,
        error: currentRead.error,
      });
      return NextResponse.json(
        { error: "Could not read the workspace's legal configuration, so nothing was changed" },
        { status: 500 }
      );
    }

    const currentSelection = readWorkspaceStageGateTemplateSelection(currentRead.data);
    const bindingUpdate = automaticStageGateUpdate(currentSelection, row);
    if (bindingUpdate.kind === "ambiguous") {
      return NextResponse.json(
        {
          error: "More than one stage-gate template covers that jurisdiction",
          hint: "Choose the workspace's stage-gate template before changing its home geography.",
        },
        { status: 409 }
      );
    }
    if (bindingUpdate.kind === "unresolved") {
      return NextResponse.json(
        { error: "No usable stage-gate template could be resolved, so nothing was changed" },
        { status: 409 }
      );
    }

    const workspaceUpdate = {
      ...row,
      ...(bindingUpdate.kind === "update" ? bindingUpdate.row : {}),
    };
    let write = createServiceRoleClient()
      .from("workspaces")
      .update(workspaceUpdate)
      .eq("id", parsed.data.workspaceId);
    if (bindingUpdate.kind === "update" && currentSelection) {
      write = write.eq("stage_gate_template_selection", currentSelection);
    }

    const { data, error } = await write
      .select(`${HOME_GEOGRAPHY_COLUMNS}, ${STAGE_GATE_CONFIGURATION_COLUMNS}`)
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
    if (!data) {
      return NextResponse.json(
        {
          error: "The workspace's legal configuration changed while the geography was being saved",
          hint: "Review the current stage-gate template and try again.",
        },
        { status: 409 }
      );
    }

    // When the workspace's home geography is a US county, load that county's
    // census tracts so the equity choropleth is populated for it — the table is
    // otherwise empty for every non-seeded county. `after()` runs this AFTER the
    // response so setting geography stays fast; it is best-effort and public
    // data (any workspace's county benefits every viewer), so a failure only
    // means the layer stays empty until something loads it, never a wrong write.
    // One derivation, shared with the map layers that scope tracts to this same
    // county — so what gets INGESTED and what gets DRAWN can never disagree.
    const county = tigerwebCountyFipsFromHomeGeography(row);
    if (county) {
      // Registering the task is itself wrapped: `after()` throws when called
      // outside a request scope (e.g. a unit test), and a best-effort tract load
      // must never turn a successful geography write into a 500.
      try {
        after(async () => {
          try {
            await ingestCensusTractsForCounty(createServiceRoleClient(), {
              stateFips: county.stateFips,
              countyFips: county.countyFips,
            });
          } catch {
            // Best-effort: the equity layer simply stays empty until re-triggered.
          }
        });
      } catch {
        // No request scope available; skip the background load.
      }
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

/**
 * Return the workspace to "no stated geography".
 *
 * This is the counterpart PATCH needs to be honest. Without it, a workspace that
 * recorded the wrong place could only ever overwrite it with another place —
 * there would be no way back to null, and null is the one answer this subsystem
 * treats as always truthful. Every reader already handles it (neutral camera,
 * unbound jurisdiction, "not set"), so clearing degrades cleanly rather than
 * falling back to somebody else's county.
 *
 * Deliberately NOT symmetrical with PATCH in one respect: no census-tract
 * `after()` load. Tracts already ingested stay — they are public reference data
 * keyed by county, useful to every workspace, and deleting them because one
 * workspace changed its mind would be destructive far outside this request's
 * scope.
 */
export async function DELETE(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.home_geography.clear", request);
  const startedAt = Date.now();

  try {
    const bodyResult = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }
    if (bodyResult.parseError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = clearHomeGeographySchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "A valid workspaceId is required" }, { status: 400 });
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

    // Clearing re-frames every map in the workspace and unbinds its
    // jurisdiction rules, so it is the same configuration action as setting —
    // and carries the same role requirement.
    if (!canAccessWorkspaceAction(HOME_GEOGRAPHY_WRITE_ACTION, membership.role)) {
      return NextResponse.json(
        { error: "Only a workspace owner or admin can clear the home geography" },
        { status: 403 }
      );
    }

    const currentRead = await supabase
      .from("workspaces")
      .select(STAGE_GATE_CONFIGURATION_COLUMNS)
      .eq("id", parsed.data.workspaceId)
      .maybeSingle();
    if (currentRead.error) {
      if (looksLikePendingSchema(currentRead.error.message)) {
        return NextResponse.json(
          {
            error: "Workspace legal configuration is not available yet",
            hint: "Apply the latest Supabase migrations before clearing a home geography.",
          },
          { status: 503 }
        );
      }
      audit.error("home_geography_clear_binding_read_failed", {
        workspaceId: parsed.data.workspaceId,
        error: currentRead.error,
      });
      return NextResponse.json(
        { error: "Could not read the workspace's legal configuration, so nothing was changed" },
        { status: 500 }
      );
    }

    const currentSelection = readWorkspaceStageGateTemplateSelection(currentRead.data);
    const resetBinding = resolveStageGateTemplateBinding();
    const shouldResetBinding =
      currentSelection === "jurisdiction_matched" ||
      currentSelection === "interim_unconfigured_default";
    const clearRow = {
      ...clearedHomeGeographyRow(),
      ...(shouldResetBinding
        ? {
            stage_gate_template_id: resetBinding.templateId,
            stage_gate_template_version: resetBinding.templateVersion,
            stage_gate_template_selection: "interim_unconfigured_default",
            stage_gate_bound_at: new Date().toISOString(),
          }
        : {}),
    };

    let clearWrite = createServiceRoleClient()
      .from("workspaces")
      .update(clearRow)
      .eq("id", parsed.data.workspaceId);
    if (shouldResetBinding) {
      clearWrite = clearWrite.eq("stage_gate_template_selection", currentSelection);
    }

    const { data, error } = await clearWrite.select("id").maybeSingle();

    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json(
          {
            error: "Workspace home geography is not available yet",
            hint: "Apply the latest Supabase migrations before clearing a home geography.",
          },
          { status: 503 }
        );
      }
      audit.error("home_geography_clear_failed", {
        workspaceId: parsed.data.workspaceId,
        error,
      });
      return NextResponse.json({ error: "Failed to clear the home geography" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        {
          error: "The workspace's legal configuration changed while the geography was being cleared",
          hint: "Review the current stage-gate template and try again.",
        },
        { status: 409 }
      );
    }

    audit.info("home_geography_cleared", {
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    // `homeGeography: null` is the same shape GET returns for an unset
    // workspace, so a caller can use one code path for both.
    return NextResponse.json(
      { workspaceId: parsed.data.workspaceId, homeGeography: null },
      { status: 200 }
    );
  } catch (error) {
    audit.error("home_geography_clear_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while clearing the home geography" },
      { status: 500 }
    );
  }
}
