import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  APPLICATION_ATTACHMENT_SELECT,
  APPLICATION_ATTACHMENT_STATUSES,
  APPLICATION_PENDING_SCHEMA_ERROR,
  canTransitionAttachmentStatus,
  looksLikePendingAssemblySchema,
  parseApplicationAttachmentRow,
  type ApplicationAttachmentStatus,
} from "@/lib/grants/application";

const paramsSchema = z.object({
  opportunityId: z.string().uuid(),
  attachmentId: z.string().uuid(),
});

const ATTACHMENT_STATUSES = APPLICATION_ATTACHMENT_STATUSES as unknown as [string, ...string[]];

// Checklist items are edited in place: status transitions, notes, metadata,
// and fulfillment links. Linking a Knowledge Base document or a report
// artifact records WHICH workspace evidence satisfies the item; both are
// validated against the opportunity's own workspace. There is no DELETE —
// an inapplicable item is marked not_applicable so the requirement stays
// visible to review instead of vanishing.
const patchAttachmentSchema = z
  .object({
    status: z.enum(ATTACHMENT_STATUSES).optional(),
    note: z.union([z.string().trim().max(4000), z.null()]).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    guidance: z.union([z.string().trim().max(4000), z.null()]).optional(),
    required: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    kbDocumentId: z.union([z.string().uuid(), z.null()]).optional(),
    reportArtifactId: z.union([z.string().uuid(), z.null()]).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ opportunityId: string; attachmentId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.attachments.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid attachment path" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = patchAttachmentSchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid attachment payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadFundingOpportunityAccess(
      supabase,
      parsedParams.data.opportunityId,
      user.id,
      "programs.write"
    );

    if (access.error) {
      audit.error("funding_opportunity_access_failed", {
        opportunityId: parsedParams.data.opportunityId,
        userId: user.id,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 });
    }

    if (!access.opportunity) {
      return NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const opportunity = access.opportunity;

    const { data: attachmentRow, error: attachmentError } = await supabase
      .from("funding_opportunity_attachments")
      .select(APPLICATION_ATTACHMENT_SELECT)
      .eq("id", parsedParams.data.attachmentId)
      .eq("opportunity_id", opportunity.id)
      .maybeSingle();

    if (attachmentError) {
      if (looksLikePendingAssemblySchema(attachmentError.message)) {
        return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
      }
      return NextResponse.json({ error: "Failed to load attachment" }, { status: 500 });
    }

    if (!attachmentRow) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const attachment = parseApplicationAttachmentRow(attachmentRow);
    if (!attachment) {
      return NextResponse.json({ error: "Stored attachment row is malformed" }, { status: 500 });
    }

    if (
      parsed.data.status !== undefined &&
      !canTransitionAttachmentStatus(
        attachment.status,
        parsed.data.status as ApplicationAttachmentStatus
      )
    ) {
      return NextResponse.json(
        { error: `Cannot move attachment status from "${attachment.status}" to "${parsed.data.status}"` },
        { status: 422 }
      );
    }

    // Attach-from-KB: the linked document must belong to the opportunity's
    // own workspace. The RLS-scoped lookup cannot see other workspaces'
    // documents, so a cross-workspace id resolves to "not found" here.
    if (parsed.data.kbDocumentId) {
      const { data: kbDocument, error: kbError } = await supabase
        .from("kb_documents")
        .select("id, workspace_id")
        .eq("id", parsed.data.kbDocumentId)
        .maybeSingle();

      if (kbError) {
        return NextResponse.json({ error: "Failed to look up Knowledge Base document" }, { status: 500 });
      }
      const kbWorkspaceId = (kbDocument as { workspace_id?: string } | null)?.workspace_id;
      if (!kbDocument || kbWorkspaceId !== opportunity.workspace_id) {
        return NextResponse.json(
          { error: "Knowledge Base document not found in this workspace" },
          { status: 422 }
        );
      }
    }

    // Attach-report-artifact: artifact → report → workspace must land in the
    // opportunity's own workspace.
    if (parsed.data.reportArtifactId) {
      const { data: artifactRow, error: artifactError } = await supabase
        .from("report_artifacts")
        .select("id, report_id")
        .eq("id", parsed.data.reportArtifactId)
        .maybeSingle();

      if (artifactError) {
        return NextResponse.json({ error: "Failed to look up report artifact" }, { status: 500 });
      }
      const reportId = (artifactRow as { report_id?: string } | null)?.report_id;
      if (!artifactRow || !reportId) {
        return NextResponse.json(
          { error: "Report artifact not found in this workspace" },
          { status: 422 }
        );
      }

      const { data: reportRow, error: reportError } = await supabase
        .from("reports")
        .select("id, workspace_id")
        .eq("id", reportId)
        .maybeSingle();

      if (reportError) {
        return NextResponse.json({ error: "Failed to look up report artifact" }, { status: 500 });
      }
      const reportWorkspaceId = (reportRow as { workspace_id?: string } | null)?.workspace_id;
      if (!reportRow || reportWorkspaceId !== opportunity.workspace_id) {
        return NextResponse.json(
          { error: "Report artifact not found in this workspace" },
          { status: 422 }
        );
      }
    }

    const updates: Record<string, unknown> = {
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (parsed.data.note !== undefined) updates.note = parsed.data.note;
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.guidance !== undefined) updates.guidance = parsed.data.guidance;
    if (parsed.data.required !== undefined) updates.required = parsed.data.required;
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder;
    if (parsed.data.kbDocumentId !== undefined) updates.kb_document_id = parsed.data.kbDocumentId;
    if (parsed.data.reportArtifactId !== undefined)
      updates.report_artifact_id = parsed.data.reportArtifactId;

    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status;
    } else if (parsed.data.kbDocumentId || parsed.data.reportArtifactId) {
      // Linking fulfillment without an explicit status marks the item attached.
      updates.status = "attached";
    }

    const { data: updated, error: updateError } = await supabase
      .from("funding_opportunity_attachments")
      .update(updates)
      .eq("id", attachment.id)
      .eq("opportunity_id", opportunity.id)
      .select(APPLICATION_ATTACHMENT_SELECT)
      .single();

    if (updateError || !updated) {
      audit.error("attachment_update_failed", {
        opportunityId: opportunity.id,
        attachmentId: attachment.id,
        userId: user.id,
        message: updateError?.message ?? "attachment_update_returned_no_row",
      });
      return NextResponse.json({ error: "Failed to update attachment" }, { status: 500 });
    }

    audit.info("attachment_updated", {
      opportunityId: opportunity.id,
      attachmentId: attachment.id,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ attachment: updated });
  } catch (error) {
    audit.error("attachment_patch_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while updating attachment" }, { status: 500 });
  }
}
