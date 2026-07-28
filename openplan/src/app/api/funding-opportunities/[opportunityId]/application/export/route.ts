import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import { renderReportPdf } from "@/lib/reports/pdf";
import {
  APPLICATION_ATTACHMENT_SELECT,
  APPLICATION_FINALIZER_PENDING_SCHEMA_ERROR,
  APPLICATION_PENDING_SCHEMA_ERROR,
  APPLICATION_SECTION_PROVENANCE_SELECT,
  looksLikePendingAssemblySchema,
  looksLikePendingFinalizerSchema,
  parseApplicationAttachmentRow,
  parseApplicationSectionRow,
  type ApplicationAttachmentRow,
  type ApplicationSectionRow,
} from "@/lib/grants/application";
import {
  applicationExportPacketLabel,
  buildGrantApplicationHtml,
  countOutstandingRequiredAttachments,
  type GrantApplicationExportSection,
  type GrantApplicationSectionProvenance,
} from "@/lib/grants/application-html";
import { loadOpportunityPursuitContext } from "@/lib/grants/pursuit";
import {
  isNarrativeExportable,
  listFlaggedNarrativeSentences,
  parseStoredNarrativeGrounding,
  type FlaggedNarrativeSentence,
} from "@/lib/grants/narrative-grounding";

/**
 * Package this opportunity's application into one PDF: cover + every section
 * (final text, or a disclosed outstanding-item block) + attachment checklist +
 * provenance appendix — rendered through the one report PDF pipeline, stored
 * in the grant-application-exports bucket, and registered append-only.
 *
 * The grounding gate here is DEFENSE IN DEPTH on top of the finalize gate: a
 * section finalized UNEDITED from a stored AI draft whose grounding does not
 * pass `isNarrativeExportable` refuses the whole export with the offending
 * sections and their flagged sentences. (An operator-EDITED final text is the
 * operator's own work product and is never re-judged by a stored verdict.)
 * Missing required attachments do NOT block — the document is stamped DRAFT
 * prominently instead, because packaging a work in progress is legitimate as
 * long as no reader can mistake it for submittable.
 */

const EXPORT_BUCKET = "grant-application-exports";

export const APPLICATION_EXPORT_SELECT =
  "id, workspace_id, opportunity_id, storage_path, pdf_engine, page_count, generated_by, generated_at";

const paramsSchema = z.object({
  opportunityId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ opportunityId: string }>;
};

type DraftRowLite = {
  id: string;
  section_id: string;
  draft_markdown: string;
  model: string | null;
  grounding_json: unknown;
};

type OffendingSection = {
  sectionId: string;
  sectionKey: string;
  title: string;
  flaggedSentences: FlaggedNarrativeSentence[];
};

/**
 * The honest disclosure for a final section whose finalizer was never
 * recorded (finalized before migration 20260727000016 added the columns).
 * updated_by is NEVER an acceptable substitute: it is touch-latest, and the
 * reorder PATCH stamps it on every row, so it can name the wrong person.
 */
export const FINALIZER_NOT_RECORDED_DISCLOSURE =
  "finalized before finalizer tracking; not recorded";

function resolveSectionProvenance(
  section: ApplicationSectionRow,
  draft: DraftRowLite | null
): GrantApplicationSectionProvenance {
  const finalizedAt = section.status === "final" ? section.finalized_at : null;
  const finalizedBy =
    section.status === "final"
      ? section.finalized_by ?? FINALIZER_NOT_RECORDED_DISCLOSURE
      : null;

  if (!section.final_markdown) {
    return {
      origin: "none",
      model: null,
      groundedSentenceCount: null,
      totalSentenceCount: null,
      finalizedBy: null,
      finalizedAt: null,
    };
  }

  if (!section.finalized_from_draft_id || !draft) {
    return {
      origin: "operator_authored",
      model: null,
      groundedSentenceCount: null,
      totalSentenceCount: null,
      finalizedBy,
      finalizedAt,
    };
  }

  const grounding = parseStoredNarrativeGrounding(draft.grounding_json);
  return {
    origin: draft.draft_markdown === section.final_markdown ? "ai_draft_unedited" : "ai_draft_edited",
    model: draft.model,
    groundedSentenceCount: grounding?.grounded_sentence_count ?? null,
    totalSentenceCount: grounding?.total_sentence_count ?? null,
    finalizedBy,
    finalizedAt,
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.application.export", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid funding opportunity id" }, { status: 400 });
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

    const [sectionsResult, attachmentsResult] = await Promise.all([
      supabase
        .from("funding_opportunity_application_sections")
        // The provenance select carries finalized_by/finalized_at — the
        // export appendix names the FINALIZER, never the last toucher.
        .select(APPLICATION_SECTION_PROVENANCE_SELECT)
        .eq("opportunity_id", opportunity.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("funding_opportunity_attachments")
        .select(APPLICATION_ATTACHMENT_SELECT)
        .eq("opportunity_id", opportunity.id)
        .order("sort_order", { ascending: true }),
    ]);

    const pendingMessage = [sectionsResult.error?.message, attachmentsResult.error?.message].find(
      (message) => looksLikePendingAssemblySchema(message)
    );
    if (pendingMessage) {
      return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
    }
    // The tables exist but the finalizer columns do not: refuse with the
    // migration to apply rather than exporting provenance without them.
    if (looksLikePendingFinalizerSchema(sectionsResult.error?.message)) {
      return NextResponse.json(
        { error: APPLICATION_FINALIZER_PENDING_SCHEMA_ERROR },
        { status: 503 }
      );
    }
    if (sectionsResult.error || attachmentsResult.error) {
      return NextResponse.json({ error: "Failed to load the application" }, { status: 500 });
    }

    const sections = ((sectionsResult.data ?? []) as unknown[])
      .map(parseApplicationSectionRow)
      .filter((row): row is ApplicationSectionRow => row !== null);
    const attachments = ((attachmentsResult.data ?? []) as unknown[])
      .map(parseApplicationAttachmentRow)
      .filter((row): row is ApplicationAttachmentRow => row !== null);

    if (sections.length === 0 && attachments.length === 0) {
      return NextResponse.json(
        { error: "No application is initialized for this opportunity — nothing to export." },
        { status: 422 }
      );
    }

    // Load the drafts that finalized sections point at, for the gate and the
    // provenance appendix.
    const finalizedDraftIds = sections
      .map((section) => section.finalized_from_draft_id)
      .filter((value): value is string => Boolean(value));

    const draftById = new Map<string, DraftRowLite>();
    if (finalizedDraftIds.length > 0) {
      const { data: draftRows, error: draftsError } = await supabase
        .from("funding_opportunity_section_drafts")
        .select("id, section_id, draft_markdown, model, grounding_json")
        .in("id", finalizedDraftIds);

      if (draftsError) {
        audit.error("application_export_drafts_load_failed", {
          opportunityId: opportunity.id,
          userId: user.id,
          message: draftsError.message,
        });
        return NextResponse.json(
          { error: "Failed to load section draft provenance" },
          { status: 500 }
        );
      }
      for (const row of (draftRows ?? []) as DraftRowLite[]) {
        draftById.set(row.id, row);
      }
    }

    // Defense in depth on the finalize gate: a section finalized UNEDITED from
    // a draft that is not exportable (not fully grounded, or never
    // faithfulness-checked) refuses the export with the offenders listed.
    const offendingSections: OffendingSection[] = [];
    for (const section of sections) {
      if (!section.final_markdown || !section.finalized_from_draft_id) continue;
      const draft = draftById.get(section.finalized_from_draft_id);
      if (!draft) continue;
      if (draft.draft_markdown !== section.final_markdown) continue; // operator-edited: human authority
      const grounding = parseStoredNarrativeGrounding(draft.grounding_json);
      if (!grounding || !isNarrativeExportable(grounding)) {
        offendingSections.push({
          sectionId: section.id,
          sectionKey: section.section_key,
          title: section.title,
          flaggedSentences: grounding ? listFlaggedNarrativeSentences(grounding) : [],
        });
      }
    }

    if (offendingSections.length > 0) {
      audit.warn("application_export_gate_refused", {
        opportunityId: opportunity.id,
        userId: user.id,
        offendingSectionKeys: offendingSections.map((section) => section.sectionKey),
      });
      return NextResponse.json(
        {
          error:
            "This application cannot be exported: section(s) were finalized unedited from AI drafts that are not fully grounded and faithfulness-checked. Review the flagged sentences, edit the text, and re-finalize.",
          offendingSections,
        },
        { status: 422 }
      );
    }

    // Program metadata for the cover — best-effort; a failed read discloses
    // "Not linked" rather than failing the export.
    let programTitle: string | null = null;
    if (opportunity.program_id) {
      const { data: programRow } = await supabase
        .from("programs")
        .select("id, title")
        .eq("id", opportunity.program_id)
        .maybeSingle();
      const title = (programRow as { title?: unknown } | null)?.title;
      programTitle = typeof title === "string" ? title : null;
    }

    const generatedAt = new Date().toISOString();
    const opportunityTitle =
      typeof opportunity.title === "string" && opportunity.title.trim()
        ? opportunity.title
        : "Funding opportunity";

    // The cover keys on the pursuit kind: a proposal packet leads with the
    // solicitation number, issuing agency, and due date. A pending pursuit
    // schema truthfully labels the packet a grant application.
    const pursuit = await loadOpportunityPursuitContext(supabase, opportunity.id);
    if (pursuit.error) {
      audit.error("application_export_pursuit_context_failed", {
        opportunityId: opportunity.id,
        userId: user.id,
        message: pursuit.error.message,
      });
      return NextResponse.json(
        { error: "Failed to load the opportunity's pursuit kind" },
        { status: 500 }
      );
    }
    const packetLabel = applicationExportPacketLabel(pursuit.context.pursuitKind);
    const exportSections: GrantApplicationExportSection[] = sections.map((section) => ({
      section,
      provenance: resolveSectionProvenance(
        section,
        section.finalized_from_draft_id ? draftById.get(section.finalized_from_draft_id) ?? null : null
      ),
    }));

    const html = buildGrantApplicationHtml({
      opportunity: {
        id: opportunity.id,
        title: opportunityTitle,
        agency_name: opportunity.agency_name ?? null,
        summary: opportunity.summary ?? null,
        expected_award_amount: opportunity.expected_award_amount ?? null,
        closes_at: opportunity.closes_at ?? null,
        opportunity_status: opportunity.opportunity_status ?? null,
        decision_state: opportunity.decision_state ?? null,
        pursuit_kind: pursuit.context.pursuitKind,
        solicitation_number: pursuit.context.solicitationNumber,
      },
      programTitle,
      sections: exportSections,
      attachments,
      generatedAt,
    });

    const pdf = await renderReportPdf(html, {
      title: `${opportunityTitle} — ${packetLabel}`,
      generatedAt,
      footerLabel: opportunityTitle,
    });

    const exportId = crypto.randomUUID();
    const storagePath = `${opportunity.workspace_id}/${opportunity.id}/${exportId}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from(EXPORT_BUCKET)
      .upload(storagePath, Buffer.from(pdf.bytes), {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      audit.error("application_export_upload_failed", {
        opportunityId: opportunity.id,
        userId: user.id,
        message: uploadError.message,
      });
      return NextResponse.json({ error: "Failed to store the exported PDF" }, { status: 500 });
    }

    const { data: exportRow, error: insertError } = await supabase
      .from("funding_opportunity_application_exports")
      .insert({
        id: exportId,
        workspace_id: opportunity.workspace_id,
        opportunity_id: opportunity.id,
        storage_path: storagePath,
        pdf_engine: pdf.engine,
        page_count: pdf.pageCount,
        generated_by: user.id,
      })
      .select(APPLICATION_EXPORT_SELECT)
      .single();

    if (insertError || !exportRow) {
      audit.error("application_export_register_failed", {
        opportunityId: opportunity.id,
        userId: user.id,
        storagePath,
        message: insertError?.message ?? "export_insert_returned_no_row",
      });
      return NextResponse.json(
        { error: "The PDF was stored but its export record could not be registered" },
        { status: 500 }
      );
    }

    const outstandingRequiredCount = countOutstandingRequiredAttachments(attachments);

    audit.info("application_exported", {
      opportunityId: opportunity.id,
      workspaceId: opportunity.workspace_id,
      userId: user.id,
      exportId,
      pdfEngine: pdf.engine,
      pageCount: pdf.pageCount,
      outstandingRequiredCount,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        export: exportRow,
        pdfEngine: pdf.engine,
        pageCount: pdf.pageCount,
        // Non-null only when the built-in writer produced the PDF — disclosed
        // to the caller exactly as it is disclosed inside the document.
        engineDisclosure: pdf.disclosure,
        outstandingRequiredCount,
        isDraftStamped: outstandingRequiredCount > 0,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("application_export_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while exporting application" }, { status: 500 });
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.application.exports.list", request);

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid funding opportunity id" }, { status: 400 });
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
      "programs.read"
    );

    if (access.error) {
      return NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 });
    }
    if (!access.opportunity) {
      return NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 });
    }
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: exports, error: exportsError } = await supabase
      .from("funding_opportunity_application_exports")
      .select(APPLICATION_EXPORT_SELECT)
      .eq("opportunity_id", access.opportunity.id)
      .order("generated_at", { ascending: false })
      .limit(50);

    if (exportsError) {
      if (looksLikePendingAssemblySchema(exportsError.message)) {
        return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
      }
      audit.error("application_exports_list_failed", {
        opportunityId: access.opportunity.id,
        message: exportsError.message,
      });
      return NextResponse.json({ error: "Failed to load stored exports" }, { status: 500 });
    }

    return NextResponse.json({ exports: exports ?? [] });
  } catch (error) {
    audit.error("application_exports_list_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while listing exports" }, { status: 500 });
  }
}
