import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  checkWorkspaceMembership,
  KB_DOCUMENT_COLUMNS,
  looksLikePendingSchema,
  resolveKbDocumentMaxBytes,
} from "@/lib/knowledge-base/documents";
import {
  kbDocumentTooLargeResponse,
  kbMembershipErrorResponse,
  normalizeKbDeclaredContentType,
  resolveKbUploadType,
  storeKbDocument,
  verifyKbUploadTarget,
} from "@/lib/knowledge-base/document-intake";
import {
  buildKbDocumentNameFilter,
  KB_DOCUMENT_LIST_LIMIT,
  resolveKbDocumentListFilters,
  resolveKbDocumentOrder,
} from "@/lib/knowledge-base/document-list-filters";
import { KB_DOC_KINDS, type KbDocKind } from "@/lib/knowledge-base/types";
import { loadWorkspaceCalendar, UTC_TIME_ZONE } from "@/lib/time/workspace-calendar";

// PDFs are retained first and extracted by the Documents worker.
export const runtime = "nodejs";
export const maxDuration = 60;

const uploadQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  // Derived from the shared taxonomy so a doc kind added there (e.g. 'drawing',
  // 'exhibit' in 20260811000005) is uploadable without re-typing the list here.
  docKind: z.enum(KB_DOC_KINDS as [KbDocKind, ...KbDocKind[]]).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  filename: z.string().trim().max(255).optional(),
});

const listQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  // Narrowing the list happens HERE, not in the browser: the read is capped, so
  // a name filter applied to the rows already loaded would leave the documents
  // past the cap exactly as unfindable as before. Every value is normalized by
  // `resolveKbDocumentListFilters`, which is why they are permissive strings
  // rather than a strict enum or date — a value it cannot use is disclosed as
  // unapplied, never a 400 a planner has to decode.
  q: z.string().max(200).optional(),
  sort: z.string().max(20).optional(),
  addedFrom: z.string().max(10).optional(),
  addedTo: z.string().max(10).optional(),
});

/**
 * One document as the request body. On the hosted site a body above about
 * 4.5 MB never arrives (KI-2026-10-12-017), so the app's uploaders stage files
 * through `./upload/start` and `./upload/complete` instead; this door stays for
 * API clients and installs without that platform limit. Both doors run the
 * same checks in `lib/knowledge-base/document-intake.ts`.
 */
export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("knowledge_base.documents.upload", request);
  const startedAt = Date.now();

  try {
    const query = uploadQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json({ error: "Invalid upload parameters" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const target = await verifyKbUploadTarget({
      supabase,
      userId: user.id,
      workspaceId: query.data.workspaceId,
      projectId: query.data.projectId,
      audit,
    });
    if (!target.ok) return target.response;

    const declaredContentType = normalizeKbDeclaredContentType(request.headers.get("content-type"));
    const uploadType = resolveKbUploadType(declaredContentType, query.data.filename);
    if (!uploadType.ok) return uploadType.response;

    // The ceiling is the operator's, resolved per request so raising the env
    // takes effect without a redeploy. Streamed: at 100 MiB, buffer-then-check
    // would be the allocation the limit exists to prevent.
    const maxBytes = resolveKbDocumentMaxBytes();
    const bodyRead = await readBytesWithLimitStreaming(request, maxBytes);
    if (!bodyRead.ok) {
      audit.warn("kb_document_body_too_large", {
        byteLength: bodyRead.byteLength,
        maxBytes,
      });
      return kbDocumentTooLargeResponse(maxBytes);
    }

    return await storeKbDocument({
      service: createServiceRoleClient(),
      workspaceId: query.data.workspaceId,
      projectId: query.data.projectId,
      userId: user.id,
      title: query.data.title,
      docKind: query.data.docKind,
      filename: query.data.filename,
      declaredContentType,
      type: uploadType.type,
      bytes: bodyRead.bytes,
      origin: new URL(request.url).origin,
      audit,
      startedAt,
    });
  } catch (error) {
    audit.error("kb_document_upload_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while uploading document" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("knowledge_base.documents.list", request);

  try {
    const query = listQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json({ error: "Invalid list parameters" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, query.data.workspaceId);
    if (!membership.ok) {
      if (membership.kind === "error") {
        audit.error("membership_lookup_failed", { message: membership.message });
      }
      return kbMembershipErrorResponse(membership);
    }

    // A date range is read on the workspace's calendar, the one the list
    // prints dates on. The calendar is only read when a date is asked for.
    let timeZone = UTC_TIME_ZONE;
    if (query.data.addedFrom || query.data.addedTo) {
      const calendar = await loadWorkspaceCalendar(supabase, query.data.workspaceId);
      if (calendar.readError) audit.warn("workspace_calendar_read_failed", { message: calendar.readError });
      timeZone = calendar.timeZone;
    }
    const filters = resolveKbDocumentListFilters({
      q: query.data.q,
      sort: query.data.sort,
      addedFrom: query.data.addedFrom,
      addedTo: query.data.addedTo,
      timeZone,
    });
    const order = resolveKbDocumentOrder(filters.sort);

    let builder = supabase
      .from("kb_documents")
      .select(KB_DOCUMENT_COLUMNS)
      .eq("workspace_id", query.data.workspaceId)
      .order(order.column, { ascending: order.ascending })
      .limit(KB_DOCUMENT_LIST_LIMIT);
    if (query.data.projectId) {
      builder = builder.eq("project_id", query.data.projectId);
    }
    if (filters.nameTerm) {
      builder = builder.or(buildKbDocumentNameFilter(filters.nameTerm));
    }
    if (filters.addedFrom) {
      builder = builder.gte("created_at", filters.addedFrom);
    }
    if (filters.addedTo) {
      builder = builder.lt("created_at", filters.addedTo);
    }

    const { data: documents, error } = await builder;
    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return kbMembershipErrorResponse({ ok: false, kind: "schema_pending", message: "" });
      }
      audit.error("kb_documents_list_failed", { message: error.message });
      return NextResponse.json({ error: "Failed to list documents" }, { status: 500 });
    }

    // `appliedFilters` is what the read DID, not what was asked for. A date the
    // route could not parse comes back absent, so the screen can say the filter
    // was not applied instead of showing an unnarrowed list under a narrowed
    // caption.
    return NextResponse.json(
      {
        documents: documents ?? [],
        appliedFilters: filters,
        limit: KB_DOCUMENT_LIST_LIMIT,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("kb_documents_list_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while listing documents" }, { status: 500 });
  }
}
