import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";

const custodySchema = z.object({
  run_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  state: z.enum(["unstarted", "retained", "unassessed"]),
}).strict();

export type RelaunchCustody = "unstarted" | "retained" | "unassessed" | "unavailable";

/** Inspect recovery state after route authorization and before changing the run.
 * This snapshot grants no execution ownership; database guards still arbitrate writes.
 */
export async function inspectRelaunchCustody(workspaceId: string, runId: string): Promise<RelaunchCustody> {
  try {
    const { data, error } = await createServiceRoleClient().rpc("inspect_model_relaunch_custody", {
      p_workspace: workspaceId,
      p_run: runId,
    });
    if (error) return "unavailable";
    const parsed = custodySchema.safeParse(data);
    if (!parsed.success || parsed.data.workspace_id !== workspaceId || parsed.data.run_id !== runId) {
      return "unavailable";
    }
    return parsed.data.state;
  } catch {
    return "unavailable";
  }
}
