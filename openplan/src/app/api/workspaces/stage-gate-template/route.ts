/**
 * Re-bind a workspace to a different stage-gate template.
 *
 * `workspaces.stage_gate_template_id` could only ever be written at workspace
 * CREATION (`/api/workspaces/bootstrap`). Every read path since then —
 * `resolveWorkspaceStageGateBinding`, the project posture header, the decisions
 * route — was built to tell a planner when their workspace holds a template
 * nobody chose, and one of those messages literally reads "Rebind this workspace
 * to the template registered for …". This is the endpoint that instruction
 * always assumed existed.
 *
 * THREE RULES, ALL LOAD-BEARING.
 *
 *   1. It writes ONE column. `stage_gate_decisions` is not touched — a recorded
 *      decision is a signed verdict a funder relies on, and re-mapping one onto
 *      another jurisdiction's gate would forge it. See
 *      `STAGE_GATE_REBIND_DECISION_INVARIANT`, which is the sentence the operator
 *      confirms against.
 *   2. An unregistered target is refused, never coerced to the default.
 *      Substituting a jurisdiction the caller did not ask for is the exact
 *      failure `template-registry.ts` exists to prevent, and a workspace bound to
 *      an unresolvable id renders no board at all.
 *   3. The response reports what the binding BECAME, resolved through the same
 *      reconciliation every reader uses — so a caller cannot be told "bound to X"
 *      by a path that never asked the registry.
 *
 * NOT AN ASSISTANT ACTION (yet). This is a deliberate omission, not an oversight:
 * registering it costs the eight files CLAUDE.md enumerates, all of them shared.
 * Until that lands, no `propose_` tool reaches this route and only a signed-in
 * owner/admin can call it.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  checkWorkspaceMembership,
  looksLikePendingSchema,
  type WorkspaceMembershipResult,
} from "@/lib/workspaces/membership";
import { stageGateTemplateRegistry } from "@/lib/stage-gates/template-registry";
import { resolveWorkspaceStageGateBinding } from "@/lib/stage-gates/template-loader";
import { STAGE_GATE_BINDING_WORKSPACE_COLUMNS } from "@/lib/stage-gates/rebind";

/**
 * Which template a workspace delivers under re-frames the gate board every
 * member sees and the checklist a funder is shown. It is workspace
 * configuration, and it takes the same role as setting the home geography.
 */
const REBIND_ACTION = "workspace.configure";

/** The projection the reconciliation needs; stated once in the read-side lib. */
const BINDING_COLUMNS = `id, ${STAGE_GATE_BINDING_WORKSPACE_COLUMNS}`;

const rebindSchema = z.object({
  workspaceId: z.string().uuid(),
  templateId: z.string().trim().min(1).max(200),
  /**
   * The template the operator believed was bound when they confirmed. Optional,
   * and when supplied it is checked: the confirmation names the gates that will
   * leave the board, and those are derived from the current binding. If another
   * member rebound the workspace in between, the operator confirmed a change
   * that is no longer the change being made.
   */
  expectedCurrentTemplateId: z.string().trim().min(1).max(200).optional(),
});

function membershipErrorResponse(result: Extract<WorkspaceMembershipResult, { ok: false }>) {
  if (result.kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Workspace schema is not available yet",
        hint: "Apply the latest Supabase migrations before changing the stage-gate template.",
      },
      { status: 503 }
    );
  }
  if (result.kind === "not_member") {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
}

export async function PATCH(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.stage_gate_template.rebind", request);
  const startedAt = Date.now();

  try {
    const bodyResult = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }
    if (bodyResult.parseError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = rebindSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid stage-gate template parameters" }, { status: 400 });
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

    if (!canAccessWorkspaceAction(REBIND_ACTION, membership.role)) {
      return NextResponse.json(
        { error: "Only a workspace owner or admin can change the stage-gate template" },
        { status: 403 }
      );
    }

    // Rule 2. Refuse an id this deployment does not register rather than binding
    // the workspace to something no board can render.
    const target = stageGateTemplateRegistry.get(parsed.data.templateId);
    if (!target) {
      audit.warn("stage_gate_template_unregistered", {
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        templateId: parsed.data.templateId,
      });
      return NextResponse.json(
        {
          error: "This deployment does not register that stage-gate template",
          details:
            "Nothing was changed. Choose one of the templates this deployment registers, or add the pack before binding to it.",
          available: stageGateTemplateRegistry.list().map((descriptor) => ({
            templateId: descriptor.templateId,
            templateName: descriptor.templateName,
            jurisdictionLabel: descriptor.jurisdiction.label,
          })),
        },
        { status: 400 }
      );
    }

    const currentRead = await supabase
      .from("workspaces")
      .select(BINDING_COLUMNS)
      .eq("id", parsed.data.workspaceId)
      .maybeSingle();

    if (currentRead.error) {
      if (looksLikePendingSchema(currentRead.error.message)) {
        return NextResponse.json(
          {
            error: "The workspace stage-gate binding is not available yet",
            hint: "Apply the latest Supabase migrations before changing the stage-gate template.",
          },
          { status: 503 }
        );
      }
      audit.error("stage_gate_template_read_failed", {
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        error: currentRead.error,
      });
      // The confirmation the operator signed off names the gates leaving the
      // board, which are derived from the CURRENT template. Writing without
      // being able to read it would apply a change nobody could have reviewed.
      return NextResponse.json(
        { error: "Could not read the workspace's current stage-gate binding, so nothing was changed" },
        { status: 500 }
      );
    }

    const currentRow = currentRead.data as Record<string, unknown> | null;
    const currentTemplateId =
      typeof currentRow?.stage_gate_template_id === "string"
        ? currentRow.stage_gate_template_id
        : null;

    if (
      parsed.data.expectedCurrentTemplateId &&
      currentTemplateId &&
      parsed.data.expectedCurrentTemplateId !== currentTemplateId
    ) {
      return NextResponse.json(
        {
          error: "This workspace's stage-gate template changed while you were reviewing",
          details: `It is now bound to "${currentTemplateId}". Nothing was changed. Review the effect of the new starting point before rebinding.`,
        },
        { status: 409 }
      );
    }

    const { data, error } = await createServiceRoleClient()
      .from("workspaces")
      .update({ stage_gate_template_id: target.descriptor.templateId })
      .eq("id", parsed.data.workspaceId)
      .select(BINDING_COLUMNS)
      .maybeSingle();

    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json(
          {
            error: "The workspace stage-gate binding is not available yet",
            hint: "Apply the latest Supabase migrations before changing the stage-gate template.",
          },
          { status: 503 }
        );
      }
      audit.error("stage_gate_template_write_failed", {
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        templateId: target.descriptor.templateId,
        error,
      });
      return NextResponse.json({ error: "Failed to change the stage-gate template" }, { status: 500 });
    }

    audit.info("stage_gate_template_rebound", {
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      fromTemplateId: currentTemplateId,
      toTemplateId: target.descriptor.templateId,
      durationMs: Date.now() - startedAt,
    });

    // Rule 3. Report the binding as the shared reconciliation reads it, from the
    // row that was actually written.
    const resolution = resolveWorkspaceStageGateBinding(data ?? currentRow);

    return NextResponse.json(
      {
        workspaceId: parsed.data.workspaceId,
        templateId: target.descriptor.templateId,
        binding: resolution.kind === "resolved" ? resolution.binding : null,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("stage_gate_template_rebind_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while changing the stage-gate template" },
      { status: 500 }
    );
  }
}
