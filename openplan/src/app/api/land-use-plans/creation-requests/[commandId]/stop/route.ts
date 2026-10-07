import { isDeepStrictEqual } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { planCreationCommandSchema } from "@/lib/land-use-plans/create-command";
import { PlanCreationError } from "@/lib/land-use-plans/create-store";
import { verifyCreationStop } from "@/lib/land-use-plans/create-stop";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

const headers = { "Cache-Control": "private, no-store" };
const paramsSchema = z.object({ commandId: z.string().uuid() }).strict();
type Context = { params: Promise<{ commandId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.creation.stop", request);
  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) throw new PlanCreationError("invalid");
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) throw new PlanCreationError("forbidden");
    try { requireProviderBrowserOrigin(request); } catch { throw new PlanCreationError("forbidden"); }
    const client = await createClient(), { data: auth, error: authError } = await client.auth.getUser();
    if (authError) throw new PlanCreationError("unavailable");
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const { membership } = await loadCurrentWorkspaceMembership(client, auth.user.id);
    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)
      || request.headers.get("x-openplan-expected-user") !== auth.user.id
      || request.headers.get("x-openplan-expected-workspace") !== membership.workspace_id) throw new PlanCreationError("forbidden");
    const body = await readBytesWithLimitStreaming(request, 2_000_000);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let commandText: string, raw: unknown;
    try { commandText = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes); raw = JSON.parse(commandText); }
    catch { throw new PlanCreationError("invalid"); }
    const command = planCreationCommandSchema.safeParse(raw);
    if (!command.success || !isDeepStrictEqual(command.data, raw) || command.data.commandId !== params.data.commandId) throw new PlanCreationError("invalid");
    const scope = { actorId: auth.user.id, workspaceId: membership.workspace_id };
    const { data, error } = await createServiceRoleClient().rpc("cancel_land_use_plan_creation", {
      p_workspace_id: scope.workspaceId, p_actor_id: scope.actorId, p_command_id: command.data.commandId, p_command_text: commandText,
    });
    if (error) throw new PlanCreationError(error.code === "42501" ? "forbidden" : error.code === "PT409" ? "conflict" : error.code === "PT400" ? "invalid" : "unavailable");
    const result = verifyCreationStop(data, scope, commandText);
    audit.info("land_use_plan_creation_stop_confirmed", { commandId: command.data.commandId, outcome: result.outcome });
    return NextResponse.json(result, { headers });
  } catch (error) {
    const failed = error instanceof PlanCreationError ? error : new PlanCreationError("unavailable");
    audit.warn("land_use_plan_creation_stop_unconfirmed", { kind: failed.kind });
    return NextResponse.json({ kind: failed.kind, error: "The request is not confirmed stopped. Keep its exact copy and retry the stop action with current staff access." }, { status: failed.status, headers });
  }
}
