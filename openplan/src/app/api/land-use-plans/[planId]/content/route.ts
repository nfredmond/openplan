import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess, loadWorkingVersion } from "@/lib/land-use-plans/api";
import { PLAN_CONTENT_NODE_KINDS } from "@/lib/land-use-plans/contracts";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const nodeKinds = [...PLAN_CONTENT_NODE_KINDS] as [string, ...string[]];
const paramsSchema = z.object({ planId: z.string().uuid() });
const contentSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    parentNodeId: z.string().uuid().nullable().optional(),
    nodeKind: z.enum(nodeKinds),
    requirementKey: z.string().trim().min(1).max(100).nullable().optional(),
    title: z.string().trim().min(1).max(240),
    body: z.string().max(100_000).nullable().optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    evidenceDocumentId: z.string().uuid().nullable().optional(),
    evidenceUrl: z.string().url().max(2_000).nullable().optional(),
  }).strict(),
  z.object({
    operation: z.literal("update"),
    nodeId: z.string().uuid(),
    parentNodeId: z.string().uuid().nullable().optional(),
    nodeKind: z.enum(nodeKinds).optional(),
    title: z.string().trim().min(1).max(240).optional(),
    body: z.string().max(100_000).nullable().optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    evidenceDocumentId: z.string().uuid().nullable().optional(),
    evidenceUrl: z.string().url().max(2_000).nullable().optional(),
  }).strict(),
  z.object({ operation: z.literal("delete"), nodeId: z.string().uuid() }).strict(),
]);

type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.content", request);
  audit.info("land_use_plan_content_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.documentJson);
  if (!body.ok) return body.response;
  const parsed = contentSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid content operation", issues: parsed.error.issues }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const version = await loadWorkingVersion(loaded.access);
  if (!version) return NextResponse.json({ error: "Content can only change on a working version" }, { status: 409 });

  const payload = parsed.data;
  const parentNodeId = "parentNodeId" in payload ? payload.parentNodeId : undefined;
  if (parentNodeId) {
    const { data: parent, error: parentError } = await loaded.access.supabase
      .from("land_use_plan_content_nodes")
      .select("id")
      .eq("id", parentNodeId)
      .eq("version_id", version.id)
      .maybeSingle();
    if (parentError) return NextResponse.json({ error: "Failed to verify the parent content" }, { status: 500 });
    if (!parent) return NextResponse.json({ error: "Parent node is outside the working version" }, { status: 400 });
  }
  const evidenceDocumentId = "evidenceDocumentId" in payload ? payload.evidenceDocumentId : undefined;
  if (evidenceDocumentId) {
    const { data: document, error: documentError } = await loaded.access.supabase
      .from("kb_documents")
      .select("id")
      .eq("id", evidenceDocumentId)
      .eq("workspace_id", loaded.access.plan.workspace_id)
      .maybeSingle();
    if (documentError) return NextResponse.json({ error: "Failed to verify the evidence document" }, { status: 500 });
    if (!document) return NextResponse.json({ error: "Evidence document is outside this workspace" }, { status: 400 });
  }
  if (payload.operation === "create") {
    const { data, error } = await loaded.access.supabase
      .from("land_use_plan_content_nodes")
      .insert({
        workspace_id: loaded.access.plan.workspace_id,
        version_id: version.id,
        parent_node_id: payload.parentNodeId ?? null,
        node_kind: payload.nodeKind,
        requirement_key: payload.requirementKey ?? null,
        title: payload.title,
        body: payload.body ?? null,
        sort_order: payload.sortOrder ?? 0,
        evidence_document_id: payload.evidenceDocumentId ?? null,
        evidence_url: payload.evidenceUrl ?? null,
        created_by: loaded.access.userId,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: "Failed to create content node" }, { status: 500 });
    return NextResponse.json({ nodeId: data.id }, { status: 201 });
  }

  if (payload.operation === "delete") {
    const deleteResult = await loaded.access.supabase
      .from("land_use_plan_content_nodes")
      .delete({ count: "exact" })
      .eq("id", payload.nodeId)
      .eq("version_id", version.id)
      .select("id")
      .maybeSingle();
    if (isWriteFailure(deleteResult.error)) return NextResponse.json({ error: "Failed to delete content node" }, { status: 500 });
    if (writeMatchedNoRows(deleteResult)) return noRowsMatchedResponse({ subject: "plan content", targetWasVerified: false });
    return NextResponse.json({ deleted: true });
  }

  const updates: Record<string, unknown> = {};
  if (payload.parentNodeId !== undefined) updates.parent_node_id = payload.parentNodeId;
  if (payload.nodeKind !== undefined) updates.node_kind = payload.nodeKind;
  if (payload.title !== undefined) updates.title = payload.title;
  if (payload.body !== undefined) updates.body = payload.body;
  if (payload.sortOrder !== undefined) updates.sort_order = payload.sortOrder;
  if (payload.evidenceDocumentId !== undefined) updates.evidence_document_id = payload.evidenceDocumentId;
  if (payload.evidenceUrl !== undefined) updates.evidence_url = payload.evidenceUrl;
  if (!Object.keys(updates).length) return NextResponse.json({ error: "No content fields were supplied" }, { status: 400 });
  const { data, error } = await loaded.access.supabase
    .from("land_use_plan_content_nodes")
    .update(updates)
    .eq("id", payload.nodeId)
    .eq("version_id", version.id)
    .select("id")
    .maybeSingle();
  if (isWriteFailure(error)) return NextResponse.json({ error: "Failed to update content node" }, { status: 500 });
  if (writeMatchedNoRows({ data, error })) return noRowsMatchedResponse({ subject: "plan content", targetWasVerified: false });
  return NextResponse.json({ updated: true });
}
