import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { providerProjectPacketSchema, providerProjectPacketHash, providerProjectPrompt } from "./provider-project-task";

export const providerScopeSchema = z.object({ workspaceId: z.string().uuid(), projectId: z.string().uuid() }).strict();
export const PROVIDER_CONNECTION_COLUMNS = "id,workspace_id,project_id,provider,device_label,expected_auth_mode,created_at,expires_at,revoked_at,last_seen_at,last_status";
export const PROVIDER_TURN_COLUMNS = "id,request_id,workspace_id,project_id,connection_id,provider,model_id,auth_mode,question,packet_canonical,packet_hash,state,attempt_id,lease_expires_at,result,provider_receipt,failure_code,created_at,started_at,finished_at";
export type ProviderService = ReturnType<typeof createServiceRoleClient>;
export type ProviderUserClient = Awaited<ReturnType<typeof createClient>>;

export class ProviderRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export function providerJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } });
}
export function providerError(error: unknown) {
  if (error instanceof ProviderRequestError) return providerJson({ error: error.code }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return providerJson({ error: "invalid_provider_request" }, 400);
  // Database/provider messages may include packet text or credentials.
  return providerJson({ error: "provider_request_unavailable" }, 503);
}
// Next can construct handler URLs with its internal localhost hostname. Host is
// the browser's addressed authority; forwarded-host is deliberately not used.
export function providerBrowserOrigin(request: Request): string {
  const internal = new URL(request.url);
  const host = request.headers.get("host") ?? internal.host;
  const scheme = request.headers.get("x-forwarded-proto") ?? internal.protocol.slice(0, -1);
  if (!host || /[\s/@?#,\\]/.test(host) || !["http", "https"].includes(scheme)) throw new ProviderRequestError("provider_origin_denied", 403);
  let addressed: URL;
  try { addressed = new URL(`${scheme}://${host}`); } catch { throw new ProviderRequestError("provider_origin_denied", 403); }
  return addressed.origin;
}
export function requireProviderBrowserOrigin(request: Request) {
  if (request.headers.get("origin") !== providerBrowserOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ProviderRequestError("provider_origin_denied", 403);
  }
}
export async function providerBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const read = await readJsonOrNullWithLimit(request, 256_000);
  if (!read.ok) throw new ProviderRequestError("provider_request_too_large", 413);
  return schema.parse(read.data);
}
export async function providerUser() {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new ProviderRequestError("unauthorized", 401);
  return { client, userId: user.id };
}
export function providerRpcError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "42501") throw new ProviderRequestError("provider_access_denied", 403);
  if (error.code === "PT409") throw new ProviderRequestError("provider_retry_conflict", 409);
  if (error.code === "22023" || error.code === "23514") throw new ProviderRequestError("invalid_provider_request", 400);
  throw new ProviderRequestError("provider_storage_unavailable", 503);
}

// Authentication remains in the browser. The connector gets a random capability
// for one personal project connection, stored on the server only as a digest.
export function newProviderConnectionToken() {
  const connectionId = randomUUID();
  const token = `op_pc_${connectionId}.${randomBytes(32).toString("base64url")}`;
  return { connectionId, token, tokenHash: createHash("sha256").update(token).digest("hex") };
}
export function providerBearer(request: Request) {
  const match = /^Bearer (op_pc_([a-f0-9-]{36})\.[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
  if (!match || !z.string().uuid().safeParse(match[2]).success) throw new ProviderRequestError("provider_token_required", 401);
  return { connectionId: match[2], tokenHash: createHash("sha256").update(match[1]).digest("hex") };
}

// Read the same stored project fields used by the existing project context,
// without loading its unrelated task, document, finance or workspace summaries.
export async function loadProviderProjectPacket(client: ProviderUserClient, userId: string, scope: z.infer<typeof providerScopeSchema>) {
  const { data: member, error: memberError } = await client.from("workspace_members").select("role")
    .eq("workspace_id", scope.workspaceId).eq("user_id", userId).maybeSingle();
  providerRpcError(memberError);
  if (!member || !["owner", "admin", "member", "viewer"].includes(String(member.role ?? "").trim().toLowerCase())) {
    throw new ProviderRequestError("provider_access_denied", 403);
  }
  const { data: row, error } = await client.from("projects")
    .select("id,workspace_id,name,summary,status,plan_type,delivery_phase,updated_at")
    .eq("id", scope.projectId).eq("workspace_id", scope.workspaceId).maybeSingle();
  providerRpcError(error);
  if (!row || row.id !== scope.projectId || row.workspace_id !== scope.workspaceId) throw new ProviderRequestError("provider_project_not_found", 404);
  const packet = providerProjectPacketSchema.parse({ version: 1, workspaceId: scope.workspaceId,
    project: { id: row.id, name: row.name, summary: row.summary, status: row.status, planType: row.plan_type, deliveryPhase: row.delivery_phase, updatedAt: row.updated_at },
    capturedAt: new Date().toISOString(), source: { id: `project:${row.id}`, label: row.name, href: `/projects/${row.id}` } });
  providerProjectPacketHash(packet);
  return packet;
}

export const retainedProviderTurnSchema = z.object({
  id: z.string().uuid(), request_id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid(),
  connection_id: z.string().uuid().nullable(), provider: z.enum(["codex", "claude", "anthropic"]), model_id: z.string().min(1).max(160),
  auth_mode: z.enum(["chatgpt", "apiKey", "claude_subscription", "workspace_api_key", "deployment_api_key"]), question: z.string().min(1).max(2000),
  packet_canonical: z.string().max(200_000), packet_hash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]), attempt_id: z.string().uuid().nullable(),
  lease_expires_at: z.string().nullable(), result: z.unknown().nullable(), provider_receipt: z.unknown().nullable(),
  failure_code: z.string().nullable(), created_at: z.string(), started_at: z.string().nullable(), finished_at: z.string().nullable(),
});
export type RetainedProviderTurn = z.infer<typeof retainedProviderTurnSchema>;
export function checkedProviderTurn(raw: unknown) {
  const turn = retainedProviderTurnSchema.parse(raw);
  const packet = providerProjectPacketSchema.parse(JSON.parse(turn.packet_canonical));
  if (createHash("sha256").update(turn.packet_canonical).digest("hex") !== turn.packet_hash || packet.workspaceId !== turn.workspace_id || packet.project.id !== turn.project_id) {
    throw new ProviderRequestError("provider_packet_mismatch", 409);
  }
  providerProjectPacketHash(packet);
  providerProjectPrompt(packet, turn.question);
  return { turn, packet };
}
