import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import {
  projectDeleteRefusalBody,
  readProjectDeleteOutcome,
} from "@/lib/projects/project-delete-outcome";

/**
 * What deleting this project would cost — asked before anything is deleted.
 *
 * WHY THIS ROUTE EXISTS. The delete control used to be click-then-refuse: the
 * only way to discover that a project carried reports, runs, funding or invoices
 * was to press Delete and read the 409. That is the wrong order for an
 * irreversible action. It also meant the confirmation dialog had nothing to
 * name — and a dialog that cannot say WHAT is attached is the native
 * `window.confirm` this app has been removing everywhere.
 *
 * It shares `readProjectDeleteOutcome` with the DELETE route, so the answer
 * shown to the planner is produced by the same code that enforces it. This is
 * advisory only: rows can appear between this read and the delete, and the
 * DELETE route counts again inside the call that deletes.
 *
 * Read-only. It counts references through the caller's own RLS-scoped client and
 * writes nothing.
 */

export const runtime = "nodejs";

const paramsSchema = z.object({ projectId: z.string().uuid() });

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.delete_preflight", request);

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Gated on the SAME permission the delete needs. A read that told a planner
    // what a delete would destroy, when they could never run that delete, would
    // be an inventory of a workspace's contents handed out on a weaker gate.
    const access = await loadProjectAccess(supabase, routeParams.data.projectId, user.id, "programs.write");

    if (access.error) {
      audit.error("project_access_failed", {
        projectId: routeParams.data.projectId,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    }
    if (!access.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const outcome = await readProjectDeleteOutcome({
      supabase,
      projectId: access.project.id,
      onDegradedCount: (message) => {
        audit.warn("project_delete_preflight_constrained_costed_count_failed", {
          projectId: access.project!.id,
          message,
        });
      },
    });

    if (outcome.kind === "unreadable") {
      // Same reading as the DELETE route: unreadable is not empty. Answering
      // "deletable" here would put a planner in front of a confirm button for a
      // delete this deployment cannot safely evaluate.
      audit.warn("project_delete_preflight_unreadable", {
        projectId: access.project.id,
        tables: outcome.tables,
        errors: outcome.messages,
      });
      return NextResponse.json(
        {
          deletable: false,
          unreadable: outcome.tables,
          headline: "OpenPlan cannot confirm what is attached to this project",
          alternative:
            "Some related records could not be read, so deleting could destroy work this check did not see. " +
            "Retry once the workspace schema is fully available.",
          blockers: [],
        },
        { status: 200 }
      );
    }

    if (outcome.kind === "refused") {
      return NextResponse.json(
        { deletable: false, ...projectDeleteRefusalBody(outcome.assessment) },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        deletable: true,
        headline: outcome.assessment.headline,
        alternative: outcome.assessment.alternative,
        blockers: [],
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("project_delete_preflight_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while checking this project" }, { status: 500 });
  }
}
