import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  DRAWDOWN_INVOICE_COLUMNS,
  buildAwardDrawdownLedger,
  toDrawdownInvoiceRead,
  type DrawdownAwardLike,
  type DrawdownInvoiceLike,
} from "@/lib/invoicing/drawdown-ledger";
import {
  buildReimbursementWorksheetHtml,
  summarizeWorksheetCostEntries,
  WORKSHEET_DOCUMENT_TITLE,
  WORKSHEET_FOOTER_NOTE,
  type WorksheetCostEntryLike,
} from "@/lib/invoicing/reimbursement-worksheet";
import {
  INTERIM_DEFAULT_RATIONALE,
  resolveReimbursementProfile,
} from "@/lib/invoicing/reimbursement-profile-binding";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { renderReportPdf } from "@/lib/reports/pdf";
import { createClient } from "@/lib/supabase/server";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { parseWorkspaceHomeGeography, resolveJurisdiction } from "@/lib/workspaces/home-geography";

/**
 * GET the reimbursement worksheet for one funding award, as a PDF.
 *
 * Generated on demand and never stored: the award row, its linked invoice
 * records and the project's cost ledger stay the single source of truth, so
 * every download reflects them as they are rather than as they were when
 * somebody last pressed a button.
 *
 * WHAT THIS ROUTE MAY NOT DO. It composes; it does not compute. Every money
 * figure on the packet is produced by `buildAwardDrawdownLedger` from rows read
 * here, and the document builder is handed the ledger rather than the rows —
 * so neither this route nor the document can arrive at a second answer for what
 * this award has claimed. The only arithmetic reachable from here that the
 * ledger does not own is the period cost total, which lives in one exported,
 * fixture-pinned function in the worksheet module.
 *
 * READ FAILURE IS NEVER A ZERO PACKET. If the invoice read fails, this refuses
 * with an error rather than rendering a worksheet showing $0 claimed against a
 * $250,000 award — a document that reads as an urgent, actionable fact and is a
 * database error. The cost ledger is different in kind: it is detail, not the
 * award position, so a failed cost read renders the packet WITH its failure
 * disclosed on the page, rather than blocking the deliverable.
 */

const paramsSchema = z.object({
  awardId: z.string().uuid(),
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
});

type RouteContext = {
  params: Promise<{ awardId: string }>;
};

const AWARD_SELECT = "id, workspace_id, project_id, title, awarded_amount, match_amount, match_posture";

type AwardRow = DrawdownAwardLike & {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string | null;
};

/** The award title as a safe download filename: `reimbursement-worksheet-corridor-study.pdf`. */
function worksheetFilename(title: string | null): string {
  const slug = (title ?? "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `reimbursement-worksheet-${slug || "award"}.pdf`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-awards.drawdown_worksheet", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid award identifier" }, { status: 400 });
    }

    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      workspaceId: url.searchParams.get("workspaceId") ?? undefined,
      periodStart: url.searchParams.get("periodStart") ?? undefined,
      periodEnd: url.searchParams.get("periodEnd") ?? undefined,
    });

    if (!parsedQuery.success) {
      audit.warn("query_validation_failed", { issues: parsedQuery.error.issues });
      return NextResponse.json({ error: "Invalid worksheet request" }, { status: 400 });
    }

    const { workspaceId, periodStart, periodEnd } = parsedQuery.data;

    if (periodStart && periodEnd && periodStart > periodEnd) {
      return NextResponse.json({ error: "Period start must not fall after period end" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: awardData, error: awardError } = await supabase
      .from("funding_awards")
      .select(AWARD_SELECT)
      .eq("id", parsedParams.data.awardId)
      .maybeSingle();

    if (awardError) {
      audit.error("funding_award_load_failed", {
        awardId: parsedParams.data.awardId,
        message: awardError.message,
      });
      return NextResponse.json({ error: "Failed to load funding award" }, { status: 500 });
    }

    // The select string is not schema-checked (Supabase clients here are
    // deliberately untyped), so the row is cast once, where it enters typed code.
    const award = awardData as unknown as AwardRow | null;

    if (!award) {
      return NextResponse.json({ error: "Funding award not found" }, { status: 404 });
    }

    // The caller names the workspace it believes it is in. A mismatch answers
    // "not found" rather than "wrong workspace": which awards exist in another
    // workspace is not this caller's business.
    if (award.workspace_id !== workspaceId) {
      audit.warn("workspace_mismatch", { awardId: award.id, requestedWorkspaceId: workspaceId });
      return NextResponse.json({ error: "Funding award not found" }, { status: 404 });
    }

    const access = await loadProjectAccess(supabase, award.project_id, user.id, "programs.read");
    if (access.error) {
      audit.error("funding_award_project_access_failed", {
        awardId: award.id,
        projectId: award.project_id,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    }

    if (!access.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const assemblyNotices: string[] = [];

    // The invoice read degrades symmetrically across the deploy/migrate window:
    // `paid_date` is new, so a deployment whose migration has not run answers
    // PostgREST's "column does not exist". That is a SETUP gap, not a fault, so
    // the read is retried without the column and the loss is DISCLOSED on the
    // page. It is retried only for a pending-schema error — never for a
    // permission or constraint failure, which would be hiding a real refusal.
    // One loose result shape for both reads: the two select strings would
    // otherwise infer different structural types, and this codebase's Supabase
    // reads are cast deliberately (the clients are untyped by convention).
    type InvoiceQueryResult = { data: unknown[] | null; error: { message?: string | null } | null };

    const readInvoices = (columns: string) =>
      supabase
        .from("billing_invoice_records")
        .select(columns)
        .eq("funding_award_id", award.id)
        .order("invoice_date", { ascending: true }) as unknown as Promise<InvoiceQueryResult>;

    let invoiceResult = await readInvoices(DRAWDOWN_INVOICE_COLUMNS);

    if (invoiceResult.error && looksLikePendingSchema(invoiceResult.error.message ?? "")) {
      const retry = await readInvoices(DRAWDOWN_INVOICE_COLUMNS.replace(", paid_date", ""));

      if (!retry.error) {
        invoiceResult = retry;
        assemblyNotices.push(
          "Payment dates are not available on this deployment yet, so no invoice shows one. Records marked paid are still counted as paid."
        );
      }
    }

    const invoiceRead = toDrawdownInvoiceRead({
      data: (invoiceResult.data ?? null) as DrawdownInvoiceLike[] | null,
      error: invoiceResult.error,
    });

    const ledgerResult = buildAwardDrawdownLedger({ award, invoiceRead });

    if (!ledgerResult.ok) {
      // A worksheet of zeros would be worse than no worksheet: it states that
      // this award has claimed nothing, which is a claim, not an outage.
      audit.error("drawdown_ledger_unavailable", {
        awardId: award.id,
        pending: ledgerResult.pending,
        message: ledgerResult.message,
      });
      return NextResponse.json(
        {
          error: ledgerResult.pending
            ? "The invoice register is not available on this deployment yet, so no worksheet can be produced."
            : "Failed to read this award's invoice records, so no worksheet can be produced.",
        },
        { status: ledgerResult.pending ? 503 : 500 }
      );
    }

    // The project's own cost ledger for the period. Detail rather than the
    // award position, so a failure is disclosed on the page instead of
    // blocking the document — but it is never rendered as "no costs".
    let costQuery = supabase
      .from("project_spend_entries")
      .select("entry_date, description, vendor_label, amount")
      .eq("project_id", award.project_id);

    if (periodStart) costQuery = costQuery.gte("entry_date", periodStart);
    if (periodEnd) costQuery = costQuery.lte("entry_date", periodEnd);

    const costResult = await costQuery.order("entry_date", { ascending: true });

    const costs = summarizeWorksheetCostEntries(
      costResult.error
        ? {
            ok: false,
            pending: looksLikePendingSchema(costResult.error.message ?? ""),
            message: costResult.error.message ?? "Cost ledger read failed.",
          }
        : { ok: true, entries: (costResult.data ?? []) as WorksheetCostEntryLike[] }
    );

    if (costResult.error) {
      audit.warn("worksheet_cost_ledger_read_failed", {
        awardId: award.id,
        projectId: award.project_id,
        message: costResult.error.message,
      });
    }

    // Which reimbursement process governs this packet. Every jurisdiction word
    // on the page comes off this binding; a failed geography read resolves as
    // "jurisdiction unknown", which is a disclosed fallback and never a guess.
    const workspaceRead = await supabase
      .from("workspaces")
      .select(
        "id, name, home_geography_source, home_geography_kind, home_geography_ref, home_country_code, home_subdivision_code"
      )
      .eq("id", award.workspace_id)
      .maybeSingle();

    if (workspaceRead.error) {
      audit.warn("worksheet_workspace_read_failed", {
        awardId: award.id,
        workspaceId: award.workspace_id,
        message: workspaceRead.error.message,
      });
      assemblyNotices.push(
        "This workspace's own record could not be read, so the reimbursement process shown is the interim default rather than one matched to where you work."
      );
    }

    const workspaceRow = (workspaceRead.error ? null : workspaceRead.data) as
      | ({ name?: string | null } & Record<string, unknown>)
      | null;

    const profileResolution = resolveReimbursementProfile({
      workspaceJurisdiction: resolveJurisdiction(parseWorkspaceHomeGeography(workspaceRow)),
    });

    // Nothing here requests a profile by id, so `unknown_profile` is
    // unreachable; the branch exists because the resolver's contract has it.
    if (profileResolution.kind !== "resolved") {
      audit.error("worksheet_profile_unresolved", { awardId: award.id });
      return NextResponse.json({ error: "Failed to resolve a reimbursement process" }, { status: 500 });
    }

    const html = buildReimbursementWorksheetHtml({
      workspace: { name: workspaceRow?.name ?? null },
      award: { title: award.title, projectName: access.project.name },
      period: periodStart || periodEnd ? { start: periodStart ?? null, end: periodEnd ?? null } : null,
      ledger: ledgerResult.ledger,
      profile: profileResolution.binding,
      interimDefaultRationale: INTERIM_DEFAULT_RATIONALE,
      costs,
      assemblyNotices,
    });

    const rendered = await renderReportPdf(html, {
      title: `${WORKSHEET_DOCUMENT_TITLE} — ${award.title ?? "Untitled award"}`,
      generatedAt: null,
      // The DISCLAIMER, not the document title. Under the built-in typesetter
      // this is the only text that reaches every page — the HTML's fixed
      // page-footer is a Chrome-only mechanism — so a middle page pulled out of
      // the packet still says who made it and that it is not the funder's form.
      footerLabel: WORKSHEET_FOOTER_NOTE,
    });

    if (rendered.engine === "builtin") {
      audit.warn("drawdown_worksheet_builtin_typesetter_used", {
        awardId: award.id,
        pageCount: rendered.pageCount,
      });
    }

    audit.info("drawdown_worksheet_generated", {
      awardId: award.id,
      workspaceId: award.workspace_id,
      projectId: award.project_id,
      userId: user.id,
      engine: rendered.engine,
      periodStart: periodStart ?? null,
      periodEnd: periodEnd ?? null,
      invoiceLineCount: ledgerResult.ledger.lines.length,
      costLineCount: costs.ok ? costs.lines.length : null,
      durationMs: Date.now() - startedAt,
    });

    const pdfBuffer = rendered.bytes.buffer.slice(
      rendered.bytes.byteOffset,
      rendered.bytes.byteOffset + rendered.bytes.byteLength
    ) as ArrayBuffer;

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${worksheetFilename(award.title)}"`,
        "x-openplan-pdf-engine": rendered.engine,
      },
    });
  } catch (error) {
    audit.error("drawdown_worksheet_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: "Unexpected error while generating the reimbursement worksheet" },
      { status: 500 }
    );
  }
}
