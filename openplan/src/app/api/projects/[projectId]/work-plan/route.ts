import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { requireWorkspaceWriteAccess } from "@/lib/auth/workspace-write-gate";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { buildWorkPlanApplication, parseAnchorDate } from "@/lib/work-plans/apply";
import { workPlanTemplateRegistry } from "@/lib/work-plans/built-in";

/**
 * APPLY A WORK-PLAN TEMPLATE TO A PROJECT.
 *
 * One template id, one anchor date, and the route computes everything else. The
 * rows it writes are ordinary `project_deliverables` and `project_milestones` —
 * the same columns, defaults and RLS path as
 * `POST /api/projects/[projectId]/records`. There is no `work_plan_templates`
 * table, no provenance column and no second write path: a template is a starting
 * point a planner then edits, and a record that remembered it came from a
 * template would invite a later "re-sync" that overwrote their edits.
 *
 * THE PLANNER SUPPLIES THE DATE. Every offset in a template is a whole number of
 * days from the anchor the template declares (notice to proceed, award, or
 * kickoff). This route never substitutes today's date for a missing anchor:
 * a work plan silently anchored on the day someone happened to click is a
 * schedule nobody agreed to, and it lands in teammates' deadline queues.
 *
 * NO ASSIGNEES. The request schema has no assignee field, `buildWorkPlanApplication`
 * cannot emit one, and neither insert below names the column. This is the same
 * refusal the records route records for the Planner Agent, applied to templates
 * and for a stronger reason: assigning work is authoring a commitment on a named
 * colleague's behalf, and one click here writes many records at once.
 *
 * ── WHY NO ASSISTANT ACTION IS REGISTERED FOR THIS, argued here so the next
 * session inherits the argument instead of re-running it. The registry stays at
 * 12 actions.
 *
 * `apply_work_plan_template` LOOKS like the safe shape the registry already
 * accepts: two values, one an id verified against an in-repo registry and one a
 * date — no prose the model authors, no money, no claim tier. It is refused on
 * both halves.
 *
 *   - THE DATE IS AUTHORED CONTENT, not an id. An anchor date is a fact about an
 *     agreement — the day a notice to proceed was issued, an award made, a
 *     kickoff held — and it exists in a contract, not in this database. A model
 *     supplying it is inventing the one input every computed deadline derives
 *     from, and a plausible wrong anchor is invisible on an approval sheet: the
 *     sheet shows one date, while the consequence is twenty dated obligations,
 *     each of which becomes an overdue item on somebody's `/my-work` queue and a
 *     line in their reminder digest. This is the RTP cost-basis refusal in
 *     another module's clothes — a single in-range number that silently re-prices
 *     everything downstream.
 *   - THE PAIRING IS AN AUTHORED JUDGEMENT. Which template fits which project is
 *     precisely the professional call the registry's own resolver refuses to
 *     make by default (`findForProject` answers `no_template` rather than
 *     guessing). An action would hand a model the choice the machinery was built
 *     to decline, and an agent working a queue of projects with no work plan has
 *     a standing incentive to empty it — the completion-signal shape that refused
 *     the RTP band assignment and the submission geofence.
 *
 * THE SHAPE THAT COULD BE ARGUED, if it is ever wanted: a copy-forward, where
 * the payload is `{ projectId, sourceProjectId }` and the route reads BOTH the
 * template id and the anchor date off a sibling project's existing records, so
 * the model authors neither. Not before a project carries a recorded anchor date
 * of its own — today it does not, which is why that shape cannot be built yet.
 *
 * Until then the route refuses a Planner Agent execution outright rather than
 * relying on the absence of an action to keep one away.
 */

const paramsSchema = z.object({ projectId: z.string().uuid() });

const applySchema = z.object({
  templateId: z.string().trim().min(1).max(120),
  /** A plain calendar date. Shape checked here, existence checked by parseAnchorDate. */
  anchorDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** How many existing titles are read for the already-there check. */
const EXISTING_TITLE_SCAN_LIMIT = 500;

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("projects.workPlan.apply", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    // Refused before anything else is read: no action is registered for this
    // endpoint, so a request claiming to be one is either a mistake or an
    // attempt to ride a route no planner approved.
    if (readAssistantExecutionSource(request) !== "manual") {
      audit.warn("planner_agent_execution_refused", { projectId: parsedParams.data.projectId });
      return NextResponse.json(
        {
          error:
            "Applying a work-plan template is not a Planner Agent action. Choosing the template and the anchor date is a professional judgement, and the anchor date is a fact about an agreement that is not in this database.",
        },
        { status: 403 }
      );
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = applySchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const anchor = parseAnchorDate(parsed.data.anchorDate);
    if (!anchor) {
      audit.warn("anchor_date_not_a_real_date", { anchorDate: parsed.data.anchorDate });
      return NextResponse.json(
        { error: "That anchor date is not a real calendar date. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }

    const entry = workPlanTemplateRegistry.get(parsed.data.templateId);
    if (!entry) {
      audit.warn("template_not_registered", { templateId: parsed.data.templateId });
      return NextResponse.json(
        { error: "No work-plan template is registered under that id." },
        { status: 404 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, workspace_id, name")
      .eq("id", parsedParams.data.projectId)
      .single();

    if (projectError || !project) {
      audit.warn("project_not_found", {
        projectId: parsedParams.data.projectId,
        message: projectError?.message ?? null,
      });
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // The project-record tables inherit the project's role-blind write policy,
    // so RLS admits any member — including a viewer. Authorize explicitly.
    const writeAccess = await requireWorkspaceWriteAccess(supabase, user.id, project.workspace_id);
    if (!writeAccess.ok) return writeAccess.response;

    // What the project already has, so a second application does not duplicate
    // it. A FAILED READ HERE IS NOT AN EMPTY PROJECT: treating it as one would
    // write a second copy of every record, which is the outcome this check
    // exists to prevent. Refuse instead — the planner can retry.
    const [existingDeliverables, existingMilestones] = await Promise.all([
      supabase
        .from("project_deliverables")
        .select("title")
        .eq("project_id", project.id)
        .limit(EXISTING_TITLE_SCAN_LIMIT),
      supabase
        .from("project_milestones")
        .select("title")
        .eq("project_id", project.id)
        .limit(EXISTING_TITLE_SCAN_LIMIT),
    ]);

    const existingReadError = existingDeliverables.error ?? existingMilestones.error;
    if (existingReadError) {
      audit.error("existing_records_read_failed", {
        projectId: project.id,
        message: existingReadError.message,
        pendingSchema: looksLikePendingSchema(existingReadError.message),
      });
      return NextResponse.json(
        {
          error:
            "This project's existing records could not be read, so the template was not applied — applying it now could duplicate work that is already there.",
          details: existingReadError.message,
        },
        { status: 500 }
      );
    }

    const plan = buildWorkPlanApplication({
      document: entry.document,
      projectId: project.id,
      createdBy: user.id,
      anchor,
      existingDeliverableTitles: ((existingDeliverables.data ?? []) as Array<{ title: string | null }>).map(
        (row) => row.title
      ),
      existingMilestoneTitles: ((existingMilestones.data ?? []) as Array<{ title: string | null }>).map(
        (row) => row.title
      ),
    });

    let createdDeliverables = 0;
    let createdMilestones = 0;

    if (plan.deliverables.length > 0) {
      const { data, error } = await supabase
        .from("project_deliverables")
        .insert(plan.deliverables)
        .select("id");
      if (error) {
        audit.error("deliverable_insert_failed", { projectId: project.id, message: error.message });
        return NextResponse.json(
          { error: "Failed to create the work plan's deliverables", details: error.message },
          { status: 500 }
        );
      }
      createdDeliverables = (data ?? []).length;
    }

    if (plan.milestones.length > 0) {
      const { data, error } = await supabase
        .from("project_milestones")
        .insert(plan.milestones)
        .select("id");
      if (error) {
        // The deliverables above are already written. Say so rather than
        // implying nothing happened: a planner who re-applies gets the
        // already-there skip, so a partial application is recoverable, and a
        // message claiming total failure would send them looking for records
        // that do exist.
        audit.error("milestone_insert_failed", {
          projectId: project.id,
          message: error.message,
          createdDeliverables,
        });
        return NextResponse.json(
          {
            error: `The work plan's ${createdDeliverables} deliverable${createdDeliverables === 1 ? "" : "s"} were created, but its milestones were not.`,
            details: error.message,
            createdDeliverables,
          },
          { status: 500 }
        );
      }
      createdMilestones = (data ?? []).length;
    }

    audit.info("work_plan_applied", {
      projectId: project.id,
      workspaceId: project.workspace_id,
      templateId: entry.descriptor.templateId,
      templateVersion: entry.descriptor.templateVersion,
      anchor: entry.descriptor.anchor,
      anchorDate: plan.anchorDate,
      createdDeliverables,
      createdMilestones,
      skippedDeliverables: plan.skippedDeliverableTitles.length,
      skippedMilestones: plan.skippedMilestoneTitles.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        templateId: entry.descriptor.templateId,
        templateName: entry.descriptor.templateName,
        anchor: entry.descriptor.anchor,
        anchorDate: plan.anchorDate,
        createdDeliverables,
        createdMilestones,
        skippedDeliverableTitles: plan.skippedDeliverableTitles,
        skippedMilestoneTitles: plan.skippedMilestoneTitles,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("projects_work_plan_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while applying the work-plan template" },
      { status: 500 }
    );
  }
}
