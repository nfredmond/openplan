import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import {
  projectDeliveryPhaseSchema,
  projectNameSchema,
  projectPlanTypeSchema,
  projectStatusSchema,
  projectSummarySchema,
} from "@/lib/projects/project-record-fields";
import {
  projectDeleteRefusalBody,
  readProjectDeleteOutcome,
} from "@/lib/projects/project-delete-outcome";
import { placeKindSchema } from "@/lib/api/place-geographies";
import { corridorGeojsonSchema } from "@/lib/models/run-launch";
import { resolvePlaceBoundary } from "@/lib/geographies/place-resolver";
import {
  clearedProjectPlace,
  PROJECT_PLACE_COLUMNS,
  projectPlaceFromDrawnArea,
  projectPlaceFromPlaceBoundary,
} from "@/lib/projects/project-place";

/**
 * The project record itself: edit it, or delete it.
 *
 * WHY THIS ROUTE EXISTS. Projects were the only top-level module with no detail
 * route at all. Plans, programs, reports, scenarios, campaigns and missions all
 * had a PATCH; a project had five sub-routes and no way to change its own row.
 * A planner who mistyped a project name was stuck with it permanently, and a
 * workspace could only ever grow — which, under the self-serve posture, is a
 * defect rather than a caveat.
 *
 * The sibling `location/route.ts` argued for sub-routes over a general PATCH so
 * that fixing the map would not "open a broad mutable surface on the project
 * record as a side effect". That reasoning was right about ITS change and is
 * left intact: location still lives in its own route, and this one does not
 * touch coordinates. Editing the record is not a side effect here; it is the
 * point.
 *
 * DELETE is the careful half. `projects` is the spine — 16 tables cascade from
 * it, 17 more get their `project_id` blanked — so this route refuses any
 * project that carries anything, naming what and where, and offers a status
 * change instead. There is no force flag; the reasoning is in
 * `project-delete-preconditions.ts`.
 */

// Setting a searched place re-resolves the boundary through TIGERweb.
export const runtime = "nodejs";

const paramsSchema = z.object({ projectId: z.string().uuid() });

const estimatedCostSchema = z.object({
  amount: z.number().finite().positive().max(1_000_000_000_000_000),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
  basisYear: z.number().int().min(1800).max(3000).nullable().optional(),
  sourceDocumentId: z.string().uuid().nullable().optional(),
});

/**
 * Every field optional, at least one required. A PATCH that names no field is a
 * caller bug worth reporting rather than a no-op worth pretending succeeded.
 *
 * `summary` accepts null to clear it; the three vocabulary fields do not,
 * because their columns are NOT NULL with defaults — clearing one has no
 * meaning, where blanking a summary does.
 */
const patchProjectSchema = z
  .object({
    name: projectNameSchema.optional(),
    summary: z.union([projectSummarySchema, z.null()]).optional(),
    status: projectStatusSchema.optional(),
    planType: projectPlanTypeSchema.optional(),
    deliveryPhase: projectDeliveryPhaseSchema.optional(),
    estimatedCost: z.union([estimatedCostSchema, z.null()]).optional(),
    /**
     * The area this project studies (20260728000009) — not its map marker,
     * which stays with `location/route.ts`.
     *
     * A searched place is sent as a REFERENCE and re-resolved here, following
     * `/api/workspaces/home-geography`: a client-supplied bbox would be an
     * unverifiable geography wearing trusted-looking provenance. A drawn area
     * is sent as geometry, because there is nothing to look it up by.
     */
    place: z
      .union([
        z.object({
          mode: z.literal("place"),
          kind: placeKindSchema,
          geoid: z.string().trim().min(5).max(7),
          label: z.string().trim().min(1).max(200).optional(),
        }),
        z.object({
          mode: z.literal("drawn"),
          geometry: corridorGeojsonSchema,
          label: z.string().trim().min(1).max(200).optional(),
        }),
        z.null(),
      ])
      .optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Provide at least one field to update.",
  });

type ProjectAccess = Awaited<ReturnType<typeof loadProjectAccess>>;

/** Shared auth + access resolution. Returns either a failure response or the access record. */
async function resolveAccess(
  request: NextRequest,
  projectId: string,
  audit: ReturnType<typeof createApiAuditLogger>
): Promise<{ response: NextResponse } | { access: ProjectAccess; userId: string; supabase: Awaited<ReturnType<typeof createClient>> }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const access = await loadProjectAccess(supabase, projectId, user.id, "programs.write");

  if (access.error) {
    audit.error("project_access_failed", {
      projectId,
      message: access.error.message,
      code: access.error.code ?? null,
    });
    return { response: NextResponse.json({ error: "Failed to verify project access" }, { status: 500 }) };
  }

  if (!access.project) {
    return { response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  }

  if (!access.membership || !access.allowed) {
    return { response: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) };
  }

  return { access, userId: user.id, supabase };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;

    const payload = patchProjectSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        { error: payload.error.issues[0]?.message ?? "Invalid project payload" },
        { status: 400 }
      );
    }

    const resolved = await resolveAccess(request, routeParams.data.projectId, audit);
    if ("response" in resolved) return resolved.response;
    const { access, userId, supabase } = resolved;
    const project = access.project!;

    const updates: Record<string, unknown> = {};
    if (payload.data.name !== undefined) updates.name = payload.data.name;
    if (payload.data.summary !== undefined) updates.summary = payload.data.summary;
    if (payload.data.status !== undefined) updates.status = payload.data.status;
    if (payload.data.planType !== undefined) updates.plan_type = payload.data.planType;
    if (payload.data.deliveryPhase !== undefined) updates.delivery_phase = payload.data.deliveryPhase;

    if (payload.data.estimatedCost !== undefined) {
      if (payload.data.estimatedCost === null) {
        Object.assign(updates, {
          estimated_cost_amount: null,
          estimated_cost_currency: null,
          estimated_cost_basis_year: null,
          estimated_cost_source_document_id: null,
          estimated_cost_recorded_by: null,
          estimated_cost_recorded_at: null,
        });
      } else {
        const sourceDocumentId = payload.data.estimatedCost.sourceDocumentId ?? null;
        if (sourceDocumentId) {
          const sourceResult = await supabase
            .from("kb_documents")
            .select("id")
            .eq("id", sourceDocumentId)
            .eq("workspace_id", project.workspace_id)
            .eq("project_id", project.id)
            .single();
          if (sourceResult.error || !sourceResult.data) {
            return NextResponse.json(
              { error: "Choose a source document attached to this project." },
              { status: 400 }
            );
          }
        }
        Object.assign(updates, {
          estimated_cost_amount: payload.data.estimatedCost.amount,
          estimated_cost_currency: payload.data.estimatedCost.currency,
          estimated_cost_basis_year: payload.data.estimatedCost.basisYear ?? null,
          estimated_cost_source_document_id: sourceDocumentId,
          estimated_cost_recorded_by: userId,
          estimated_cost_recorded_at: new Date().toISOString(),
        });
      }
    }

    if (payload.data.place !== undefined) {
      if (payload.data.place === null) {
        Object.assign(updates, clearedProjectPlace());
      } else if (payload.data.place.mode === "place") {
        const boundary = await resolvePlaceBoundary(payload.data.place.kind, payload.data.place.geoid);
        if (!boundary) {
          // Fail closed. Recording the id without a verified boundary would
          // leave an area that renders as an empty or wrong extent everywhere
          // it is inherited — and inheritance is the whole point of the column.
          audit.warn("project_place_unresolved", {
            projectId: routeParams.data.projectId,
            kind: payload.data.place.kind,
            geoid: payload.data.place.geoid,
          });
          return NextResponse.json(
            {
              error: "Could not resolve that place",
              message:
                "The boundary service did not return a boundary for that place. Search for it again and pick it from the list.",
            },
            { status: 404 }
          );
        }
        Object.assign(
          updates,
          projectPlaceFromPlaceBoundary(boundary, { label: payload.data.place.label ?? null })
        );
      } else {
        const drawn = projectPlaceFromDrawnArea(payload.data.place.geometry, {
          label: payload.data.place.label ?? null,
        });
        if (!drawn) {
          return NextResponse.json(
            { error: "That drawn area has no usable coordinates." },
            { status: 400 }
          );
        }
        Object.assign(updates, drawn);
      }
    }

    // User (RLS) client: projects_update re-checks membership and, since
    // 20260728000006, the restrictive writer policy re-checks role — so the
    // explicit gate above is defence in depth rather than the only guard.
    const { data, error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", project.id)
      .select(`id, name, summary, status, plan_type, delivery_phase, estimated_cost_amount, estimated_cost_currency, estimated_cost_basis_year, estimated_cost_source_document_id, estimated_cost_recorded_at, updated_at, ${PROJECT_PLACE_COLUMNS}`)
      .single();

    if (isWriteFailure(error)) {
      audit.error("project_update_failed", {
        projectId: project.id,
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      // `resolveAccess` read this exact project row through the caller's own
      // client and passed the role gate, so a write that matches nothing is the
      // database refusing what the application allowed — not a missing project.
      audit.error("project_update_matched_no_rows", {
        projectId: project.id,
        workspaceId: project.workspace_id,
        userId,
        role: access.membership?.role ?? null,
      });
      return noRowsMatchedResponse({ subject: "project", targetWasVerified: true });
    }

    audit.info("project_updated", {
      projectId: project.id,
      workspaceId: project.workspace_id,
      userId,
      fields: Object.keys(updates),
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ project: data }, { status: 200 });
  } catch (error) {
    audit.error("project_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating project" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.delete", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const resolved = await resolveAccess(request, routeParams.data.projectId, audit);
    if ("response" in resolved) return resolved.response;
    const { access, userId, supabase } = resolved;
    const project = access.project!;

    // Count every reference before touching anything, through the same reader
    // the pre-flight check uses — so what the dialog told the planner and what
    // this route enforces cannot drift apart. RLS scopes these counts to the
    // caller's workspace, which is the same scope the delete would act in.
    const outcome = await readProjectDeleteOutcome({
      supabase,
      projectId: project.id,
      onDegradedCount: (message) => {
        audit.warn("project_delete_constrained_costed_count_failed", {
          projectId: project.id,
          message,
        });
      },
    });

    if (outcome.kind === "unreadable") {
      // A relation we cannot read is not a relation that is empty. Refusing is
      // the only safe reading — the alternative is deleting rows we failed to
      // notice.
      audit.warn("project_delete_precondition_unreadable", {
        projectId: project.id,
        tables: outcome.tables,
        errors: outcome.messages,
      });
      return NextResponse.json(
        {
          error: "Cannot confirm what is attached to this project",
          message:
            "Some related records could not be read, so deleting could destroy work this check did not see. " +
            "Retry once the workspace schema is fully available.",
          unreadable: outcome.tables,
        },
        { status: 503 }
      );
    }

    if (outcome.kind === "refused") {
      audit.info("project_delete_refused", {
        projectId: project.id,
        workspaceId: project.workspace_id,
        userId,
        blockerCount: outcome.assessment.blockers.length,
        hasCommitments: outcome.assessment.hasCommitments,
      });
      return NextResponse.json(
        { error: "Project is not empty", ...projectDeleteRefusalBody(outcome.assessment) },
        { status: 409 }
      );
    }

    // `.select()` so the deleted row comes back. A DELETE that matches nothing
    // is a SUCCESSFUL statement that changed nothing — which is exactly what
    // happened before 20260728000008, when `projects` had no DELETE policy at
    // all and RLS silently filtered every row out. Reporting "deleted" on that
    // is worse than failing, because the planner believes the project is gone.
    const { data: removed, error } = await supabase
      .from("projects")
      .delete()
      .eq("id", project.id)
      .select("id");

    if (error) {
      audit.error("project_delete_failed", {
        projectId: project.id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
    }

    if (!removed || removed.length === 0) {
      audit.error("project_delete_removed_nothing", {
        projectId: project.id,
        workspaceId: project.workspace_id,
        userId,
      });
      return NextResponse.json(
        {
          error: "Project was not deleted",
          message:
            "The delete was accepted but removed no rows, so the project is still there. " +
            "This usually means the workspace delete policy is missing on this deployment.",
        },
        { status: 500 }
      );
    }

    audit.info("project_deleted", {
      projectId: project.id,
      workspaceId: project.workspace_id,
      userId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ deleted: { id: project.id, name: project.name } }, { status: 200 });
  } catch (error) {
    audit.error("project_delete_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while deleting project" }, { status: 500 });
  }
}
