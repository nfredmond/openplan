import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  APPLICATION_PENDING_SCHEMA_ERROR,
  APPLICATION_SECTION_SELECT,
  canTransitionSectionStatus,
  looksLikePendingAssemblySchema,
  parseApplicationSectionRow,
  type ApplicationSectionStatus,
} from "@/lib/grants/application";
import { GRANT_APPLICATION_EVIDENCE_KINDS } from "@/lib/grants/program-catalog";

const paramsSchema = z.object({
  opportunityId: z.string().uuid(),
  sectionId: z.string().uuid(),
});

const EVIDENCE_KINDS = GRANT_APPLICATION_EVIDENCE_KINDS as unknown as [string, ...string[]];

// Status 'final' is deliberately absent here: finalization carries its own
// gate (final markdown + the isNarrativeExportable check for unedited AI
// drafts) and ships with the per-section drafting flow.
const patchSectionSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    guidance: z.union([z.string().trim().max(4000), z.null()]).optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    status: z.enum(["not_started", "drafting", "operator_review"]).optional(),
    suggestedEvidence: z.array(z.enum(EVIDENCE_KINDS)).max(EVIDENCE_KINDS.length).optional(),
    aiDraftingEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ opportunityId: string; sectionId: string }>;
};

type SectionAccess =
  | { response: NextResponse }
  | {
      response: null;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
      opportunity: { id: string; workspace_id: string };
      sectionRow: Record<string, unknown>;
    };

async function loadSectionForWrite(
  context: RouteContext,
  audit: ReturnType<typeof createApiAuditLogger>
): Promise<SectionAccess> {
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);
  if (!parsedParams.success) {
    return { response: NextResponse.json({ error: "Invalid section path" }, { status: 400 }) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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
    return {
      response: NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 }),
    };
  }

  if (!access.opportunity) {
    return { response: NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 }) };
  }

  if (!access.membership || !access.allowed) {
    return { response: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) };
  }

  const { data: sectionRow, error: sectionError } = await supabase
    .from("funding_opportunity_application_sections")
    .select(APPLICATION_SECTION_SELECT)
    .eq("id", parsedParams.data.sectionId)
    .eq("opportunity_id", access.opportunity.id)
    .maybeSingle();

  if (sectionError) {
    if (looksLikePendingAssemblySchema(sectionError.message)) {
      return {
        response: NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 }),
      };
    }
    return { response: NextResponse.json({ error: "Failed to load section" }, { status: 500 }) };
  }

  if (!sectionRow) {
    return { response: NextResponse.json({ error: "Section not found" }, { status: 404 }) };
  }

  return {
    response: null,
    supabase,
    userId: user.id,
    opportunity: access.opportunity,
    sectionRow: sectionRow as Record<string, unknown>,
  };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.sections.patch", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = patchSectionSchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid section payload" }, { status: 400 });
    }

    const loaded = await loadSectionForWrite(context, audit);
    if (loaded.response) return loaded.response;
    const { supabase, userId, opportunity, sectionRow } = loaded;

    const section = parseApplicationSectionRow(sectionRow);
    if (!section) {
      return NextResponse.json({ error: "Stored section row is malformed" }, { status: 500 });
    }

    if (parsed.data.status !== undefined) {
      if (!canTransitionSectionStatus(section.status, parsed.data.status as ApplicationSectionStatus)) {
        return NextResponse.json(
          { error: `Cannot move section status from "${section.status}" to "${parsed.data.status}"` },
          { status: 422 }
        );
      }
    }

    // The never-AI rule is a ratchet on catalog-seeded sections: an operator
    // can always tighten a section to non-draftable, but a catalog section
    // pinned non-draftable (budgets, fees, certifications) can never be
    // flipped back to draftable.
    if (
      parsed.data.aiDraftingEnabled === true &&
      section.source === "catalog" &&
      !section.ai_drafting_enabled
    ) {
      return NextResponse.json(
        {
          error:
            "This catalog section is pinned as never AI-drafted (budget, fee, or certification content); it cannot be made draftable.",
        },
        { status: 422 }
      );
    }

    const updates: Record<string, unknown> = {
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.guidance !== undefined) updates.guidance = parsed.data.guidance;
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.suggestedEvidence !== undefined)
      updates.suggested_evidence = parsed.data.suggestedEvidence;
    if (parsed.data.aiDraftingEnabled !== undefined)
      updates.ai_drafting_enabled = parsed.data.aiDraftingEnabled;

    const { data: updated, error: updateError } = await supabase
      .from("funding_opportunity_application_sections")
      .update(updates)
      .eq("id", section.id)
      .eq("opportunity_id", opportunity.id)
      .select(APPLICATION_SECTION_SELECT)
      .single();

    if (updateError || !updated) {
      audit.error("section_update_failed", {
        opportunityId: opportunity.id,
        sectionId: section.id,
        userId,
        message: updateError?.message ?? "section_update_returned_no_row",
      });
      return NextResponse.json({ error: "Failed to update section" }, { status: 500 });
    }

    audit.info("section_updated", {
      opportunityId: opportunity.id,
      sectionId: section.id,
      userId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ section: updated });
  } catch (error) {
    audit.error("section_patch_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while updating section" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.sections.delete", request);
  const startedAt = Date.now();

  try {
    const loaded = await loadSectionForWrite(context, audit);
    if (loaded.response) return loaded.response;
    const { supabase, userId, opportunity, sectionRow } = loaded;

    const section = parseApplicationSectionRow(sectionRow);
    if (!section) {
      return NextResponse.json({ error: "Stored section row is malformed" }, { status: 500 });
    }

    // Only custom sections are deletable. A catalog-seeded section names part
    // of the program's real application structure — removing it would hide a
    // requirement from review instead of resolving it.
    if (section.source !== "custom") {
      return NextResponse.json(
        { error: "Catalog-seeded sections cannot be deleted; edit them or leave them for review." },
        { status: 422 }
      );
    }

    const { error: deleteError } = await supabase
      .from("funding_opportunity_application_sections")
      .delete()
      .eq("id", section.id)
      .eq("opportunity_id", opportunity.id);

    if (deleteError) {
      audit.error("section_delete_failed", {
        opportunityId: opportunity.id,
        sectionId: section.id,
        userId,
        message: deleteError.message,
      });
      return NextResponse.json({ error: "Failed to delete section" }, { status: 500 });
    }

    audit.info("section_deleted", {
      opportunityId: opportunity.id,
      sectionId: section.id,
      userId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    audit.error("section_delete_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while deleting section" }, { status: 500 });
  }
}
