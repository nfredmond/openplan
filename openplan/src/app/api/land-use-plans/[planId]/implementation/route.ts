import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess, loadWorkingVersion } from "@/lib/land-use-plans/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({ planId: z.string().uuid() });
const statusSchema = z.enum(["not_started", "in_progress", "completed", "deferred"]);
const actionSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    contentNodeId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(240),
    description: z.string().max(20_000).nullable().optional(),
    responsibleParty: z.string().trim().max(240).nullable().optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
    dueOn: z.string().date().nullable().optional(),
    status: statusSchema.optional(),
    projectId: z.string().uuid().nullable().optional(),
    programId: z.string().uuid().nullable().optional(),
    evidenceDocumentId: z.string().uuid().nullable().optional(),
  }).strict(),
  z.object({
    operation: z.literal("update"),
    actionId: z.string().uuid(),
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().max(20_000).nullable().optional(),
    responsibleParty: z.string().trim().max(240).nullable().optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
    dueOn: z.string().date().nullable().optional(),
    status: statusSchema.optional(),
    projectId: z.string().uuid().nullable().optional(),
    programId: z.string().uuid().nullable().optional(),
    evidenceDocumentId: z.string().uuid().nullable().optional(),
  }).strict(),
  z.object({
    operation: z.literal("update_status"),
    actionId: z.string().uuid(),
    status: statusSchema,
    evidenceDocumentId: z.string().uuid().nullable().optional(),
  }).strict(),
  z.object({ operation: z.literal("delete"), actionId: z.string().uuid() }).strict(),
]);

type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.implementation", request);
  audit.info("land_use_plan_implementation_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
  if (!body.ok) return body.response;
  const parsed = actionSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid implementation operation", issues: parsed.error.issues }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const { access } = loaded;
  const working = await loadWorkingVersion(access);
  const payload = parsed.data;

  const versionId = working?.id ?? access.plan.current_adopted_version_id;
  if (!versionId) return NextResponse.json({ error: "No editable or adopted version exists" }, { status: 409 });
  if (!working && payload.operation !== "update_status") {
    return NextResponse.json({ error: "A frozen version only accepts implementation status updates" }, { status: 409 });
  }

  async function workspaceReferenceExists(table: string, id: string | null | undefined) {
    if (!id) return true;
    const { data, error } = await access.supabase.from(table).select("*").eq("id", id).eq("workspace_id", access.plan.workspace_id).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }
  if ("projectId" in payload && !(await workspaceReferenceExists("projects", payload.projectId))) {
    return NextResponse.json({ error: "Project is outside this workspace" }, { status: 400 });
  }
  if ("programId" in payload && !(await workspaceReferenceExists("programs", payload.programId))) {
    return NextResponse.json({ error: "Program is outside this workspace" }, { status: 400 });
  }
  if ("evidenceDocumentId" in payload && !(await workspaceReferenceExists("kb_documents", payload.evidenceDocumentId))) {
    return NextResponse.json({ error: "Evidence document is outside this workspace" }, { status: 400 });
  }
  if ("assigneeUserId" in payload && payload.assigneeUserId) {
    const { data: assignee, error: assigneeError } = await access.supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", access.plan.workspace_id)
      .eq("user_id", payload.assigneeUserId)
      .maybeSingle();
    if (assigneeError) return NextResponse.json({ error: "Failed to verify the assignee" }, { status: 500 });
    if (!assignee) return NextResponse.json({ error: "Assignee is outside this workspace" }, { status: 400 });
  }
  if (payload.operation === "create" && payload.contentNodeId) {
    const { data: contentNode, error: contentNodeError } = await access.supabase
      .from("land_use_plan_content_nodes")
      .select("id")
      .eq("id", payload.contentNodeId)
      .eq("version_id", versionId)
      .maybeSingle();
    if (contentNodeError) return NextResponse.json({ error: "Failed to verify the linked content" }, { status: 500 });
    if (!contentNode) return NextResponse.json({ error: "Content node is outside this plan version" }, { status: 400 });
  }

  if (payload.operation === "create") {
    const { data, error } = await access.supabase.from("land_use_plan_implementation_actions").insert({
      workspace_id: access.plan.workspace_id,
      version_id: versionId,
      content_node_id: payload.contentNodeId ?? null,
      title: payload.title,
      description: payload.description ?? null,
      responsible_party: payload.responsibleParty ?? null,
      assignee_user_id: payload.assigneeUserId ?? null,
      due_on: payload.dueOn ?? null,
      status: payload.status ?? "not_started",
      project_id: payload.projectId ?? null,
      program_id: payload.programId ?? null,
      evidence_document_id: payload.evidenceDocumentId ?? null,
      created_by: access.userId,
    }).select("id").single();
    if (error) return NextResponse.json({ error: "Failed to create implementation action" }, { status: 500 });
    return NextResponse.json({ actionId: data.id }, { status: 201 });
  }

  if (payload.operation === "delete") {
    const deleteResult = await access.supabase.from("land_use_plan_implementation_actions").delete().eq("id", payload.actionId).eq("version_id", versionId).select("id").maybeSingle();
    if (isWriteFailure(deleteResult.error)) return NextResponse.json({ error: "Failed to delete implementation action" }, { status: 500 });
    if (writeMatchedNoRows(deleteResult)) return noRowsMatchedResponse({ subject: "implementation action", targetWasVerified: false });
    return NextResponse.json({ deleted: true });
  }

  const updates: Record<string, unknown> = {};
  if (payload.operation === "update_status") {
    updates.status = payload.status;
    if (payload.evidenceDocumentId !== undefined) updates.evidence_document_id = payload.evidenceDocumentId;
  } else {
    if (payload.title !== undefined) updates.title = payload.title;
    if (payload.description !== undefined) updates.description = payload.description;
    if (payload.responsibleParty !== undefined) updates.responsible_party = payload.responsibleParty;
    if (payload.assigneeUserId !== undefined) updates.assignee_user_id = payload.assigneeUserId;
    if (payload.dueOn !== undefined) updates.due_on = payload.dueOn;
    if (payload.status !== undefined) updates.status = payload.status;
    if (payload.projectId !== undefined) updates.project_id = payload.projectId;
    if (payload.programId !== undefined) updates.program_id = payload.programId;
    if (payload.evidenceDocumentId !== undefined) updates.evidence_document_id = payload.evidenceDocumentId;
  }
  if (!Object.keys(updates).length) return NextResponse.json({ error: "No implementation fields supplied" }, { status: 400 });
  const { data, error } = await access.supabase.from("land_use_plan_implementation_actions").update(updates).eq("id", payload.actionId).eq("version_id", versionId).select("id").maybeSingle();
  if (isWriteFailure(error)) return NextResponse.json({ error: "Failed to update implementation action" }, { status: 500 });
  if (writeMatchedNoRows({ data, error })) return noRowsMatchedResponse({ subject: "implementation action", targetWasVerified: false });
  return NextResponse.json({ updated: true });
}
