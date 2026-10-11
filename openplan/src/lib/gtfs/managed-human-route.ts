import { join } from "node:path";
import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "../supabase/server";
import { checkWorkspaceMembership } from "../workspaces/membership";
import { isReadOnlyWorkspaceRole } from "../auth/role-matrix";
import { readAssistantExecutionSource } from "../assistant/action-approval-server";
import { gtfsQueueOptions } from "./managed-worker-queue";
import { managedGtfsEnabled } from "./managed-route";

/** Human writes retain their own command journal beside admission and worker
 * files. Manual session authority precedes private files and service dispatch.
 */
export async function authorizeGtfsHumanRoute(request: NextRequest, workspaceId: string, writing: boolean): Promise<
 { response: NextResponse } | { actorId: string; service: ReturnType<typeof createServiceRoleClient> }> {
 if (writing && readAssistantExecutionSource(request) !== "manual") return { response: NextResponse.json({ error: "Planner Agent managed transit decisions are not available",
  detail: "A planner must review and issue this command directly. Agent approval and audit for these commands are not established." }, { status: 403 }) };
 const client = await createClient(), { data: { user } } = await client.auth.getUser();
 if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
 const membership = await checkWorkspaceMembership(client, user.id, workspaceId);
 if (!membership.ok) return { response: NextResponse.json({ error: membership.kind === "not_member" ? "Workspace not found" : "Workspace membership is unavailable" }, { status: membership.kind === "not_member" ? 404 : 503 }) };
 if (writing && isReadOnlyWorkspaceRole(membership.role)) return { response: NextResponse.json({ error: "Viewers have read-only access to this workspace" }, { status: 403 }) };
 if (!managedGtfsEnabled()) return { response: NextResponse.json({ error: "Managed transit ingestion is not enabled on this installation" }, { status: 409 }) };
 return { actorId: user.id, service: createServiceRoleClient() };
}
export function managedGtfsHumanDirectory(commandId: string, env: Partial<NodeJS.ProcessEnv> = process.env) {
 const options = gtfsQueueOptions(["--once"], env);
 if (options.help) throw new Error("GTFS human command configuration is unavailable");
 const command = z.string().uuid().transform(value => value.toLowerCase()).parse(commandId);
 return { ...options, directory: join(`${options.directory}-human`, command) };
}
