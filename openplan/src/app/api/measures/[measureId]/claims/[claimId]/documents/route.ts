/**
 * Attaching a claim's backup to the claim.
 *
 * THERE IS NO UPLOAD HERE, AND THAT IS THE DESIGN. The bytes already live in
 * the Knowledge Base (`kb_documents`, 20260723000001), which owns the storage
 * bucket, the extraction pipeline and the download route that re-verifies scope
 * on every dereference. The Document Library already indexes that table, so
 * this lane adds NO new library source — one would list the same invoice twice,
 * once under "Knowledge Base" and once under "Measure claims".
 *
 * So attaching is a LINK: pick a document the workspace already holds, say what
 * it is (`documentRole`), and the claim carries it. A second byte store for the
 * same PDFs would be a second place for them to rot.
 *
 * The link is ON DELETE RESTRICT at the document end: deleting the invoice that
 * substantiated a paid claim out of a public fund would strand the evidence
 * while leaving the payment on the record.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import {
  insertNotReadableBackResponse,
  isWriteFailure,
  noRowsMatchedResponse,
  writeMatchedNoRows,
} from "@/lib/http/write-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import {
  MEASURE_CLAIM_COLUMNS,
  MEASURE_CLAIM_DOCUMENT_COLUMNS,
  MEASURE_CLAIM_DOCUMENT_ROLES,
} from "@/lib/measures/claims";
import { authorizeMeasureWrite } from "@/lib/measures/write-authorization";

const POSTGRES_UNIQUE_VIOLATION = "23505";

const paramsSchema = z.object({ measureId: z.string().uuid(), claimId: z.string().uuid() });
const roleValues = MEASURE_CLAIM_DOCUMENT_ROLES.map((entry) => entry.value) as [string, ...string[]];

const attachSchema = z.object({
  kbDocumentId: z.string().uuid(),
  documentRole: z.enum(roleValues).optional(),
  note: z.string().trim().max(2000).optional(),
});

const detachSchema = z.object({ claimDocumentId: z.string().uuid() });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ measureId: string; claimId: string }> }
) {
  const audit = createApiAuditLogger("measures.claims.documents.attach", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid measure or claim id" }, { status: 400 });

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = attachSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid attachment payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    const claimResult = await supabase
      .from("measure_claims")
      .select(MEASURE_CLAIM_COLUMNS)
      .eq("id", parsedParams.data.claimId)
      .eq("measure_fund_id", authorization.fund.id)
      .maybeSingle();
    const claimFailure = classifyRouteReadFailure("the claim", claimResult);
    if (claimFailure) {
      audit.error("claim_lookup_failed", { message: claimFailure.message });
      return NextResponse.json(claimFailure.body, { status: claimFailure.status });
    }
    const claim = claimResult.data as { id: string } | null;
    if (!claim) return NextResponse.json({ error: "Claim not found" }, { status: 404 });

    // The document must belong to the same workspace. RLS would refuse the read
    // anyway, but checking here turns a foreign-key error into a sentence.
    const documentResult = await supabase
      .from("kb_documents")
      .select("id, workspace_id, title, status")
      .eq("id", payload.data.kbDocumentId)
      .eq("workspace_id", authorization.workspaceId)
      .maybeSingle();
    const documentFailure = classifyRouteReadFailure("the document", documentResult);
    if (documentFailure) {
      audit.error("document_lookup_failed", { message: documentFailure.message });
      return NextResponse.json(documentFailure.body, { status: documentFailure.status });
    }
    if (!documentResult.data) {
      return NextResponse.json(
        {
          error: "Document not found in this workspace",
          details: "Upload it to the Knowledge Base first — this attaches a document the workspace already holds.",
        },
        { status: 404 }
      );
    }

    const { data, error } = await supabase
      .from("measure_claim_documents")
      .insert({
        workspace_id: authorization.workspaceId,
        claim_id: claim.id,
        kb_document_id: payload.data.kbDocumentId,
        document_role: payload.data.documentRole ?? "other",
        note: payload.data.note?.trim() || null,
        attached_by: authorization.userId,
      })
      .select(MEASURE_CLAIM_DOCUMENT_COLUMNS)
      .single();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return NextResponse.json({ error: "That document is already attached to this claim" }, { status: 409 });
      }
      audit.error("insert_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to attach the document" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      return insertNotReadableBackResponse({ subject: "attachment" });
    }

    audit.info("attached", {
      measureId: parsedParams.data.measureId,
      claimId: claim.id,
      kbDocumentId: payload.data.kbDocumentId,
    });
    return NextResponse.json({ claimDocument: data }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to attach the document" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ measureId: string; claimId: string }> }
) {
  const audit = createApiAuditLogger("measures.claims.documents.detach", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid measure or claim id" }, { status: 400 });

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = detachSchema.safeParse(body.data);
    if (!payload.success) return NextResponse.json({ error: "Invalid detach payload" }, { status: 400 });

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    // Detaching removes the LINK, never the document. The bytes stay in the
    // Knowledge Base where they were uploaded and where the library indexes
    // them; nothing here can delete a workspace's file.
    const { data, error } = await supabase
      .from("measure_claim_documents")
      .delete()
      .eq("id", payload.data.claimDocumentId)
      .eq("claim_id", parsedParams.data.claimId)
      .eq("workspace_id", authorization.workspaceId)
      .select("id")
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("delete_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to detach the document" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      return noRowsMatchedResponse({ subject: "attachment", targetWasVerified: false });
    }

    audit.info("detached", {
      measureId: parsedParams.data.measureId,
      claimId: parsedParams.data.claimId,
      claimDocumentId: payload.data.claimDocumentId,
    });
    return NextResponse.json({ ok: true, claimDocumentId: payload.data.claimDocumentId });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to detach the document" }, { status: 500 });
  }
}
