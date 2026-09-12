import { NextRequest } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { providerBody, providerError, providerJson, providerRpcError, providerUser, requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { requireIntegrationKeyManager } from "@/lib/integrations/route-authz";
import { API_CONNECTION_COLUMNS, API_REVISION_COLUMNS, apiConnectionMetadataSchema, saveProviderApiConnection } from "@/lib/integrations/provider-api-connections";
import { ProviderApiCredentialError } from "@/lib/integrations/provider-api-credentials";

const scopeSchema = z.object({ workspaceId: z.string().uuid() }).strict();
const listSchema = scopeSchema.extend({ offset: z.coerce.number().int().min(0).max(100_000).default(0) });
const saveSchema = scopeSchema.extend({ connectionId: z.string().uuid(), revisionId: z.string().uuid(),
  expectedRevisionId: z.string().uuid().nullable(), configuration: z.unknown(), apiKey: z.unknown() }).strict();
const revokeSchema = scopeSchema.extend({ connectionId: z.string().uuid(), expectedRevisionId: z.string().uuid() }).strict();

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.provider_api_connections.list", request);
  try {
    const scope = listSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const { client, userId } = await providerUser();
    const member = await client.from("workspace_members").select("workspace_id,role").eq("workspace_id", scope.workspaceId).eq("user_id", userId).maybeSingle();
    providerRpcError(member.error);
    if (!member.data || member.data.workspace_id !== scope.workspaceId || !["owner", "admin", "member", "viewer"].includes(member.data.role)) return providerJson({ error: "workspace_not_found" }, 404);
    const listed = await client.from("workspace_provider_api_connections")
      .select(`${API_CONNECTION_COLUMNS},current_revision:workspace_provider_api_revisions!workspace_provider_api_current_revision(${API_REVISION_COLUMNS})`, { count: "exact" })
      .eq("workspace_id", scope.workspaceId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(scope.offset, scope.offset + 49);
    providerRpcError(listed.error);
    audit.info("connections_read", { workspaceId: scope.workspaceId, count: listed.data?.length ?? 0 });
    return providerJson({ connections: listed.data ?? [], total: listed.count, offset: scope.offset,
      nextOffset: listed.count !== null && scope.offset + 50 < listed.count ? scope.offset + 50 : null });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

export async function PUT(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.provider_api_connections.save", request);
  try {
    requireProviderBrowserOrigin(request);
    const body = await providerBody(request, saveSchema);
    const access = await requireIntegrationKeyManager(body.workspaceId);
    if (!access.ok) return access.response;
    const saved = await saveProviderApiConnection({ ...body, configuration: body.configuration, apiKey: body.apiKey, service: createServiceRoleClient(), userId: access.userId });
    audit.info("connection_revision_retained", { workspaceId: body.workspaceId, connectionId: body.connectionId, revisionId: body.revisionId, created: saved.created });
    return providerJson(saved, saved.created ? 201 : 200);
  } catch (error) {
    const response = error instanceof ProviderApiCredentialError ? providerJson({ error: error.code }, 409) : providerError(error);
    audit.warn("request_refused", { status: response.status }); return response;
  }
}

export async function DELETE(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.provider_api_connections.revoke", request);
  try {
    requireProviderBrowserOrigin(request);
    const body = await providerBody(request, revokeSchema);
    const access = await requireIntegrationKeyManager(body.workspaceId);
    if (!access.ok) return access.response;
    const saved = await createServiceRoleClient().rpc("revoke_workspace_provider_api_connection", {
      p_user_id: access.userId, p_workspace_id: body.workspaceId, p_connection_id: body.connectionId, p_expected_revision_id: body.expectedRevisionId,
    });
    providerRpcError(saved.error);
    const connection = apiConnectionMetadataSchema.parse(saved.data);
    if (connection.id !== body.connectionId || connection.workspace_id !== body.workspaceId || connection.current_revision_id !== body.expectedRevisionId || connection.revoked_at === null) {
      return providerJson({ error: "provider_revocation_unconfirmed" }, 409);
    }
    audit.info("connection_revoked", { workspaceId: body.workspaceId, connectionId: body.connectionId });
    return providerJson({ connection });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}
