import { createHash } from "node:crypto";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { readFrozenPlanIdentity } from "./frozen-identity";
import { serializeFrozenRecord } from "./versioning";
import { IMPLEMENTATION_REPORT_COMMAND_LIMIT, implementationReportCommandSchema, implementationReportResultSchema,
  implementationReportScopeSchema, matchesImplementationReport, type ImplementationReportScope } from "./implementation-report-command";

type Store = ReturnType<typeof createServiceRoleClient>;
const statuses = { invalid: 400, forbidden: 403, missing: 404, conflict: 409, unavailable: 503 } as const;
export class ImplementationReportError extends Error {
  readonly status: number;
  constructor(public readonly kind: keyof typeof statuses) { super(kind); this.status = statuses[kind]; }
}

/** Find exact recovery before reading an adopted version that may have changed. */
export async function executeImplementationReport(client: Store, input: ImplementationReportScope, commandText: string) {
  const parsedScope = implementationReportScopeSchema.safeParse(input);
  if (!parsedScope.success) throw new ImplementationReportError("invalid");
  const scope = parsedScope.data;
  if (Buffer.byteLength(commandText, "utf8") > IMPLEMENTATION_REPORT_COMMAND_LIMIT) throw new ImplementationReportError("invalid");
  let raw: unknown;
  try { raw = JSON.parse(commandText); } catch { throw new ImplementationReportError("invalid"); }
  const parsedCommand = implementationReportCommandSchema.safeParse(raw);
  if (!parsedCommand.success) throw new ImplementationReportError("invalid");
  const command = parsedCommand.data;
  const previous = await client.from("land_use_plan_implementation_report_commands").select("command_id")
    .eq("plan_id", scope.planId).eq("workspace_id", scope.workspaceId).eq("command_id", command.commandId).maybeSingle();
  if (previous.error || (previous.data && previous.data.command_id !== command.commandId)) throw new ImplementationReportError("unavailable");
  let snapshotText: string | null = null;
  if (!previous.data) {
    const retained = await client.from("land_use_plan_versions")
      .select("id, workspace_id, plan_id, version_number, state, content_hash, frozen_snapshot")
      .eq("id", command.versionId).eq("plan_id", scope.planId).eq("workspace_id", scope.workspaceId).maybeSingle();
    if (retained.error) throw new ImplementationReportError("unavailable");
    const version = retained.data;
    if (!version || version.id !== command.versionId || version.plan_id !== scope.planId || version.workspace_id !== scope.workspaceId
      || version.state !== "adopted" || version.content_hash !== command.expectedVersionHash
      || !readFrozenPlanIdentity(version.frozen_snapshot, scope.planId, version.id, version.version_number, version.content_hash)) {
      throw new ImplementationReportError("conflict");
    }
    snapshotText = serializeFrozenRecord(version.frozen_snapshot);
  }
  const { data, error } = await client.rpc("create_land_use_plan_implementation_report", {
    p_plan_id: scope.planId, p_workspace_id: scope.workspaceId, p_actor_id: scope.actorId,
    p_command_id: command.commandId, p_command_text: commandText, p_adopted_snapshot_text: snapshotText,
  });
  if (error) throw new ImplementationReportError(error.code === "PT400" ? "invalid" : error.code === "42501" ? "forbidden"
    : error.code === "PT404" ? "missing" : error.code === "PT409" ? "conflict" : "unavailable");
  const result = implementationReportResultSchema.safeParse(data);
  if (!result.success || !matchesImplementationReport(result.data, scope, command)
    || result.data.commandSha256 !== createHash("sha256").update(commandText).digest("hex")
    || (previous.data && !result.data.replayed)) throw new ImplementationReportError("unavailable");
  return result.data;
}
