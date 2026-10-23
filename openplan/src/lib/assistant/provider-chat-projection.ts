import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CHAT_PROJECTION, canonicalChat, chatHash, checkChatEnvelope, chatScopeSchema, type ChatScope, type ChatEnvelope } from "./provider-chat-task";

export type ChatSession = Pick<SupabaseClient, "from" | "rpc" | "auth">;
const workspaceRow = z.object({ id: z.string().uuid(), name: z.string().nullable() }).strict();
const memberRow = z.object({ workspace_id: z.string().uuid(), user_id: z.string().uuid(), role: z.string() }).strict();
const indexRow = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), name: z.string().nullable(), status: z.string().nullable(),
  delivery_phase: z.string().nullable(), updated_at: z.string().nullable() }).strict();
const projectRow = indexRow.extend({ summary: z.string().nullable(), plan_type: z.string().nullable() }).strict();
export class ChatProjectionError extends Error {
  constructor(public readonly state: "access_lost" | "unavailable", public readonly code: string) { super(code); }
}

// Only a live authenticated session may construct these projections. The final
// release RPC repeats the entire access graph inside its custody transaction.
export async function prepareChatProjection(session: ChatSession, userId: string, rawScope: ChatScope, turnId: string, stepId: string | null = null,
  mode: "initial" | "index" | "project" = "initial", projectId?: string): Promise<ChatEnvelope[]> {
  const scope = chatScopeSchema.parse(rawScope), workspaceId = scope.target.workspaceId;
  const { data: auth, error: authError } = await session.auth.getUser();
  if (authError || auth.user?.id !== userId) throw new ChatProjectionError("unavailable", "chat_session_required");
  const membership = await session.from("workspace_members").select(CHAT_PROJECTION.membership).eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  const workspace = await session.from("workspaces").select(CHAT_PROJECTION.workspace).eq("id", workspaceId).maybeSingle();
  if (membership.error || workspace.error) throw new ChatProjectionError("unavailable", "chat_access_indeterminate");
  if (!membership.data || !workspace.data) throw new ChatProjectionError("access_lost", "chat_access_lost");
  const member = memberRow.parse(membership.data), ownWorkspace = workspaceRow.parse(workspace.data);
  if (member.user_id !== userId || member.workspace_id !== workspaceId || ownWorkspace.id !== workspaceId) throw new ChatProjectionError("access_lost", "chat_identity_mismatch");
  const capturedAt = new Date().toISOString();
  const anchor = (kind: "membership" | "workspace" | "project" | "index_query", table: "workspace_members" | "workspaces" | "projects", key: string, id: string | null, version: string | null = null) => ({
    anchorId: `${kind}:${key}`, kind, table, primaryKey: key, workspaceId, projectId: id, permission: "read" as const,
    projectionId: CHAT_PROJECTION.id as "assistant_chat_minimal_context_v1", projectionRevision: 1 as const, observedVersion: version, observedAt: capturedAt });
  const base = [anchor("membership", "workspace_members", `${workspaceId}:${userId}`, null), anchor("workspace", "workspaces", workspaceId, null)];
  function envelope(dataClass: ChatEnvelope["dataClass"], content: unknown, projects: Array<{ id: string; updated_at: string | null }> = [], queryDependency: ChatEnvelope["queryDependency"] = null) {
    const anchors = [...base, ...projects.map(p => anchor("project", "projects", p.id, p.id, p.updated_at))];
    if (queryDependency) anchors.push(anchor("index_query", "projects", workspaceId, null));
    const canonicalProjectedContent = canonicalChat(content);
    return checkChatEnvelope({ envelopeId: randomUUID(), turnId, stepId, dataClass, projectionId: CHAT_PROJECTION.id, projectionRevision: 1,
      capturedAt, sources: anchors.filter(a => a.kind !== "index_query").map(a => ({ table: a.table, primaryKey: a.primaryKey, observedVersion: a.observedVersion })),
      accessAnchors: anchors, queryDependency, canonicalProjectedContent, contentHash: chatHash(canonicalProjectedContent), availability: "available",
      omissions: [...CHAT_PROJECTION.excluded], truncation: queryDependency?.possiblyTruncated ?? false }, scope, turnId);
  }
  const result: ChatEnvelope[] = [];
  if (mode === "initial") result.push(envelope("workspace_identity", { workspaceId, workspaceName: ownWorkspace.name }));
  const ids = mode === "project" ? [projectId] : mode === "initial" ? scope.selectedProjectIds : [];
  for (const id of ids) {
    if (!id || !scope.selectedProjectIds.includes(id)) throw new ChatProjectionError("access_lost", "chat_project_not_selected");
    const response = await session.from("projects").select(CHAT_PROJECTION.project).eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    if (response.error) throw new ChatProjectionError("unavailable", "chat_project_unavailable");
    if (!response.data) throw new ChatProjectionError("access_lost", "chat_project_access_lost");
    const p = projectRow.parse(response.data);
    if (p.id !== id || p.workspace_id !== workspaceId) throw new ChatProjectionError("access_lost", "chat_project_moved");
    result.push(envelope("selected_project_summary", { id: p.id, name: p.name, summary: p.summary, status: p.status,
      planType: p.plan_type, deliveryPhase: p.delivery_phase, updatedAt: p.updated_at, href: `/projects/${p.id}` }, [p]));
  }
  if (mode === "index") {
    if (!scope.includeWorkspaceIndex) throw new ChatProjectionError("access_lost", "chat_index_not_accepted");
    const response = await session.from("projects").select(CHAT_PROJECTION.index).eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(25);
    if (response.error || !Array.isArray(response.data)) throw new ChatProjectionError("unavailable", "chat_index_unavailable");
    const projects = z.array(indexRow).max(25).parse(response.data);
    if (projects.some(p => p.workspace_id !== workspaceId)) throw new ChatProjectionError("access_lost", "chat_index_mismatch");
    const rows = projects.map(p => ({ id: p.id, name: p.name, status: p.status, deliveryPhase: p.delivery_phase, updatedAt: p.updated_at }));
    result.push(envelope("workspace_project_index", { rows, returnedCount: rows.length, possiblyTruncated: rows.length === 25 }, projects,
      { workspaceId, columns: CHAT_PROJECTION.index, order: ["updated_at DESC", "id ASC"], limit: 25,
        returnedProjectIds: projects.map(p => p.id), returnedCount: projects.length, possiblyTruncated: projects.length === 25 }));
  }
  return result;
}

export function plainChatScope(scope: ChatScope): ChatScope {
  return chatScopeSchema.parse({ target: scope.target, selectedProjectIds: scope.selectedProjectIds, includeWorkspaceIndex: scope.includeWorkspaceIndex });
}
