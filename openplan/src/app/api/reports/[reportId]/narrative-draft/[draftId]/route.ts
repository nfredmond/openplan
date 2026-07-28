import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  isNarrativeExportable,
  listFlaggedNarrativeSentences,
  parseStoredNarrativeGrounding,
  stripFactCitationTokens,
} from "@/lib/grants/narrative-grounding";
import { parseStoredDraft } from "@/lib/reports/narrative-drafts";

/**
 * PATCH /api/reports/[reportId]/narrative-draft/[draftId] — the operator
 * review action on one stored report-section draft.
 *
 * The acceptance gate is the whole point:
 * - Accept AS-IS is allowed ONLY when the stored grounding passes
 *   `isNarrativeExportable` (every sentence cited AND the numeric-faithfulness
 *   belt ran and passed). A draft with flagged sentences cannot flow verbatim
 *   into a generated packet.
 * - Otherwise the operator MUST have edited: an `acceptedMarkdown` that
 *   genuinely differs from the draft becomes operator-authored text and is
 *   accepted on the operator's authority, like any prose they typed.
 * - `dismissed` is terminal for the row (and any non-draft status is final) —
 *   regenerate a new draft instead of resurrecting an old one.
 *
 * Only the review fields ever change here; the database enforces the same via
 * a column-scoped UPDATE grant (migration 20260727000013).
 */

const paramsSchema = z.object({
  reportId: z.string().uuid(),
  draftId: z.string().uuid(),
});

const reviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept"),
    acceptedMarkdown: z.string().trim().min(1).max(40000).optional(),
  }),
  z.object({ action: z.literal("dismiss") }),
]);

type RouteContext = {
  params: Promise<{ reportId: string; draftId: string }>;
};

const DRAFT_REVIEW_COLUMNS =
  "id, workspace_id, target_kind, target_id, section_key, draft_markdown, model, grounding_json, grounded_sentence_count, total_sentence_count, facts_hash, status, accepted_markdown, accepted_by, accepted_at, created_by, created_at";

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("reports.narrative-draft.review", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid draft id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = reviewSchema.safeParse(payloadBody.data ?? null);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json({ error: "Invalid draft review payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: draftRow, error: draftError } = await supabase
      .from("document_narrative_drafts")
      .select(DRAFT_REVIEW_COLUMNS)
      .eq("id", parsedParams.data.draftId)
      .eq("target_kind", "report_section")
      .eq("target_id", parsedParams.data.reportId)
      .maybeSingle();

    if (draftError) {
      audit.error("draft_lookup_failed", {
        draftId: parsedParams.data.draftId,
        message: draftError.message,
        code: draftError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load narrative draft" }, { status: 500 });
    }

    const draft = parseStoredDraft(draftRow);
    if (!draft || !draft.workspace_id) {
      return NextResponse.json({ error: "Narrative draft not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", draft.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        draftId: draft.id,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (!membership || !canAccessWorkspaceAction("report.generate", membership.role)) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    // The review state machine is one-way: draft -> accepted | dismissed.
    // Dismissed is terminal, and an accepted row is never re-reviewed —
    // regenerate a new draft instead.
    if (draft.status !== "draft") {
      return NextResponse.json(
        {
          error:
            draft.status === "dismissed"
              ? "This draft was dismissed; dismissal is terminal. Generate a new draft instead."
              : "This draft was already accepted. Generate a new draft to revise it.",
        },
        { status: 409 }
      );
    }

    let updates: Record<string, unknown>;

    if (parsedBody.data.action === "dismiss") {
      updates = { status: "dismissed" };
    } else {
      const acceptedMarkdown = parsedBody.data.acceptedMarkdown?.trim();
      // Edited means genuinely different from the draft — in EITHER stored
      // form. The review UI shows the token-stripped text, so an untouched
      // textarea equals the stripped draft, not the raw one; neither counts
      // as an edit.
      const operatorEdited =
        acceptedMarkdown !== undefined &&
        acceptedMarkdown !== draft.draft_markdown.trim() &&
        acceptedMarkdown !== stripFactCitationTokens(draft.draft_markdown);

      if (operatorEdited) {
        // Operator-authored text: accepted on the operator's authority, like
        // any prose they typed into the packet.
        updates = {
          status: "accepted",
          accepted_markdown: acceptedMarkdown,
          accepted_by: user.id,
          accepted_at: new Date().toISOString(),
        };
      } else {
        // Accept-as-is: the machine-drafted text may flow verbatim into a
        // generated packet ONLY when every sentence is grounded and the
        // faithfulness belt ran.
        const grounding = parseStoredNarrativeGrounding(draft.grounding_json);
        if (!grounding || !isNarrativeExportable(grounding)) {
          const flaggedCount = grounding ? listFlaggedNarrativeSentences(grounding).length : null;
          audit.warn("draft_accept_blocked_ungrounded", {
            draftId: draft.id,
            userId: user.id,
            flaggedCount,
          });
          return NextResponse.json(
            {
              error:
                flaggedCount && flaggedCount > 0
                  ? `This draft cannot be accepted as-is: ${flaggedCount} sentence${flaggedCount === 1 ? "" : "s"} failed citation-grounding or faithfulness checks. Edit the text to fix or remove the flagged sentences, or regenerate.`
                  : "This draft cannot be accepted as-is: its grounding validation is missing or did not fully pass. Edit the text (which makes it operator-authored) or regenerate.",
            },
            { status: 422 }
          );
        }

        updates = {
          status: "accepted",
          accepted_markdown: draft.draft_markdown,
          accepted_by: user.id,
          accepted_at: new Date().toISOString(),
        };
      }
    }

    const { data: updatedRow, error: updateError } = await supabase
      .from("document_narrative_drafts")
      .update(updates)
      .eq("id", draft.id)
      .select(DRAFT_REVIEW_COLUMNS)
      .single();

    if (updateError || !updatedRow) {
      audit.error("draft_review_update_failed", {
        draftId: draft.id,
        userId: user.id,
        message: updateError?.message ?? "draft_review_update_returned_no_row",
      });
      return NextResponse.json({ error: "Failed to update narrative draft" }, { status: 500 });
    }

    audit.info("draft_reviewed", {
      draftId: draft.id,
      reportId: draft.target_id,
      sectionKey: draft.section_key,
      action: parsedBody.data.action,
      status: (updates as { status: string }).status,
      operatorEdited:
        parsedBody.data.action === "accept" &&
        (updates as { accepted_markdown?: string }).accepted_markdown !== draft.draft_markdown,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ draft: updatedRow });
  } catch (error) {
    audit.error("draft_review_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while reviewing draft" }, { status: 500 });
  }
}
