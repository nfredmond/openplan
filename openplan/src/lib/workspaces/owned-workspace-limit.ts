import { z } from "zod";
import type { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * How many workspaces one person may own on this deployment.
 *
 * Abuse protection for a deployment with public signup, set by whoever runs
 * it. It is not a tier: OpenPlan is free, and nothing here can be bought. Each
 * workspace carries its own AI and run allowance, so without a limit one
 * account could multiply those by making more workspaces.
 *
 * The count and the creation happen together in `create_owned_workspace`
 * (migration 20261017000010), under a per-person lock, so parallel requests
 * cannot all pass the count. The function is callable by the service role only.
 */

/** The environment, or any plain map of settings a test passes instead. */
type Env = Readonly<Record<string, string | undefined>>;

const OWNED_WORKSPACE_LIMIT_ENV = "OPENPLAN_MAX_OWNED_WORKSPACES";
export const DEFAULT_OWNED_WORKSPACE_LIMIT = 5;

/**
 * The configured limit. Anything that is not a positive whole number falls back
 * to the default, so a typo can neither lock everyone out (0) nor remove the
 * limit.
 */
export function resolveOwnedWorkspaceLimit(env: Env = process.env): number {
  const raw = env[OWNED_WORKSPACE_LIMIT_ENV]?.trim();
  if (!raw || !/^[0-9]+$/.test(raw)) return DEFAULT_OWNED_WORKSPACE_LIMIT;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_OWNED_WORKSPACE_LIMIT;
}

export function ownedWorkspaceLimitMessage(limit: number): string {
  return (
    `You already own ${limit} ${limit === 1 ? "workspace" : "workspaces"}, the most this OpenPlan site allows. ` +
    "Ask whoever runs this site to raise the limit."
  );
}

type ServiceRpcClient = Pick<ReturnType<typeof createServiceRoleClient>, "rpc">;

export type OwnedWorkspaceInput = {
  userId: string;
  name: string;
  slug: string;
  stageGateTemplateId: string;
  stageGateTemplateVersion: string;
  stageGateTemplateSelection: string;
  stageGateBindingSource: string;
  limit: number;
};

const createdWorkspaceSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  stage_gate_template_id: z.string(),
  stage_gate_template_version: z.string(),
  stage_gate_template_selection: z.string(),
});

const replySchema = z.discriminatedUnion("created", [
  z.object({ created: z.literal(true), owned: z.number().int(), limit: z.number().int(), workspace: createdWorkspaceSchema }),
  z.object({ created: z.literal(false), owned: z.number().int(), limit: z.number().int() }),
]);

export type OwnedWorkspaceCreation =
  | { status: "created"; workspace: z.infer<typeof createdWorkspaceSchema> }
  | { status: "limit_reached"; owned: number; limit: number }
  | { status: "error"; error: { code?: string | null; message?: string } };

/** Create one workspace owned by `userId`, unless they already own `limit`. */
export async function createOwnedWorkspace(
  service: ServiceRpcClient,
  input: OwnedWorkspaceInput
): Promise<OwnedWorkspaceCreation> {
  const { data, error } = await service.rpc("create_owned_workspace", {
    p_user_id: input.userId,
    p_name: input.name,
    p_slug: input.slug,
    p_stage_gate_template_id: input.stageGateTemplateId,
    p_stage_gate_template_version: input.stageGateTemplateVersion,
    p_stage_gate_template_selection: input.stageGateTemplateSelection,
    p_stage_gate_binding_source: input.stageGateBindingSource,
    p_max_owned: input.limit,
  });
  if (error) return { status: "error", error: { code: error.code ?? null, message: error.message } };
  const parsed = replySchema.safeParse(data);
  if (!parsed.success) return { status: "error", error: { code: null, message: "unexpected workspace creation reply" } };
  if (!parsed.data.created) return { status: "limit_reached", owned: parsed.data.owned, limit: parsed.data.limit };
  return { status: "created", workspace: parsed.data.workspace };
}
